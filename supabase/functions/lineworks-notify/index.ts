import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { getAccessToken, loadConfig, sendTextMessage } from "./lineworks.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on the server.")
      return json({ error: "サーバー側の設定が不足しています。" }, 500)
    }

    // 呼び出し元がログイン済みかを検証する
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: "認証情報がありません。" }, 401)
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData?.user) {
      return json({ error: "ログイン情報が確認できません。再度ログインしてください。" }, 401)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // 通知の一斉送信は管理者のみに許可する
    const { data: callerStaff, error: callerStaffError } = await adminClient
      .from('office_staff')
      .select('role')
      .eq('auth_user_id', callerData.user.id)
      .maybeSingle()

    if (callerStaffError) throw callerStaffError
    if (!callerStaff || callerStaff.role !== 'admin') {
      return json({ error: "この操作には管理者権限が必要です。" }, 403)
    }

    const { message, workerIds } = await req.json()
    if (typeof message !== 'string' || !message.trim()) {
      return json({ error: "メッセージを入力してください。" }, 400)
    }
    // LINE WORKS のテキストメッセージ上限に合わせて長さを制限する
    if (message.length > 1000) {
      return json({ error: "メッセージは1000文字以内で入力してください。" }, 400)
    }

    // 通知機能が有効かどうかを確認する
    const { data: settings, error: settingsError } = await adminClient
      .from('system_settings')
      .select('lineworks_enabled')
      .eq('id', 1)
      .maybeSingle()

    if (settingsError) throw settingsError
    if (!settings?.lineworks_enabled) {
      return json({ error: "LINE WORKS 通知が無効になっています。システム設定から有効にしてください。" }, 409)
    }

    // 宛先を取得する。workerIds の指定がなければ在籍中の作業員全員が対象。
    let query = adminClient
      .from('Workers')
      .select('id, name, lineworks_user_id')
      .not('lineworks_user_id', 'is', null)
      .is('resignation_date', null)

    if (Array.isArray(workerIds) && workerIds.length > 0) {
      query = query.in('id', workerIds)
    }

    const { data: workers, error: workersError } = await query
    if (workersError) throw workersError

    const targets = (workers ?? []).filter((w) => w.lineworks_user_id?.trim())
    if (targets.length === 0) {
      return json({ error: "送信先がありません。作業員に LINE WORKS ID を設定してください。" }, 404)
    }

    const config = loadConfig()
    const token = await getAccessToken(config)

    // 1件の失敗で全体を止めないよう、宛先ごとに結果を集計する
    const results = await Promise.all(
      targets.map(async (worker) => {
        try {
          await sendTextMessage(config, token, worker.lineworks_user_id!.trim(), message)
          return { workerId: worker.id, name: worker.name, ok: true }
        } catch (e: any) {
          console.error(`LINE WORKS send failed for worker ${worker.id}:`, e?.message)
          return { workerId: worker.id, name: worker.name, ok: false, error: e?.message ?? "不明なエラー" }
        }
      }),
    )

    const sent = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)

    return json({
      success: failed.length === 0,
      sentCount: sent.length,
      failedCount: failed.length,
      failed: failed.map((f) => ({ name: f.name, error: f.error })),
    })

  } catch (error: any) {
    console.error("Error in lineworks-notify function:", error)
    return json({ error: error.message || "通知の送信に失敗しました。" }, 500)
  }
})
