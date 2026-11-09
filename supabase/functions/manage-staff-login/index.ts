// 担当者のログインID管理（設計: docs/specs/login-id.md §5）
//
// ログインIDは Supabase Auth のメールアドレス `<ID>@login.invalid` として持つ。
// 管理者（admin / system_admin）だけが呼べる。admin は office / worker / viewer の行まで、
// admin / system_admin の行は system_admin だけが操作できる（判定は DB の assert_can_manage_staff_login）。
//
// action:
//   create          … ログインのない担当者にIDとパスワードを発行する
//   assign_login_id … 移行用。メールでログインしていた担当者にIDを割り当てる（パスワードは任意）
//   reset_password  … パスワードを管理者が決めた値に変える（対象者は全端末でログアウトされる）
//   change_login_id … IDを変える
//   delete          … 担当者の行と Auth ユーザーを削除する（作業員にも紐付いたログインは残す）
//
// target: 'worker' のときは作業員のログイン（設計: docs/specs/worker-login.md §5）。workerId を受け取る。
//   create / reset_password / change_login_id … 担当者と同じ
//   link_staff_account … 担当者（office 以上・ログインIDあり）のログインを作業員にも紐付ける
//   unlink / delete    … 紐付けを外す／作業員の行を消す（担当者と共有でなければ Auth ユーザーも消す）
//   sync_ban           … 退職日に合わせて BAN / 解除する（事務も呼べる。BAN するかは DB の退職日で決める）
//
// ここは HTTP の受け口と呼び出し元の認証だけ。処理本体は handler.ts（Vitest でテストしている）。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { handleAction, HttpError, type AdminClient } from "./handler.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on the server.")
      throw new HttpError(500, "サーバー側の設定が不足しています。")
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new HttpError(401, "認証情報がありません。")

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData?.user) {
      throw new HttpError(401, "ログイン情報が確認できません。再度ログインしてください。")
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json().catch(() => ({}))
    const forwardedFor = req.headers.get('x-forwarded-for')?.trim() || null
    const result = await handleAction(admin as unknown as AdminClient, callerData.user.id, body, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: req.headers.get('cf-connecting-ip')?.trim() || forwardedFor?.split(',')[0]?.trim() || null,
      forwardedFor,
    })
    return json(result)
  } catch (error: unknown) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error("Error in manage-staff-login function:", error)
    return json({ error: (error as Error)?.message || "処理に失敗しました。" }, 500)
  }
})
