import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on the server.")
      return new Response(
        JSON.stringify({ error: "サーバー側の設定が不足しています。" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 呼び出し元がログイン済みかを検証（管理者画面はログイン済みユーザーのみ到達できるが、二重に確認する）
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "認証情報がありません。" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData?.user) {
      return new Response(
        JSON.stringify({ error: "ログイン情報が確認できません。再度ログインしてください。" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { staffId, email } = await req.json()
    if (!staffId || !email) {
      return new Response(
        JSON.stringify({ error: "staffIdとemailは必須です。" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: staffRow, error: staffFetchError } = await adminClient
      .from('office_staff')
      .select('id, name, auth_user_id')
      .eq('id', staffId)
      .maybeSingle()

    if (staffFetchError) throw staffFetchError
    if (!staffRow) {
      return new Response(
        JSON.stringify({ error: "対象の担当者が見つかりません。" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (staffRow.auth_user_id) {
      return new Response(
        JSON.stringify({ error: "この担当者は既に招待済みです。" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { office_staff_id: staffRow.id, office_staff_name: staffRow.name },
    })
    if (inviteError) throw inviteError

    const newAuthUserId = inviteData?.user?.id
    if (!newAuthUserId) {
      throw new Error("招待ユーザーの作成に失敗しました。")
    }

    const { error: updateError } = await adminClient
      .from('office_staff')
      .update({ auth_user_id: newAuthUserId })
      .eq('id', staffRow.id)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    )

  } catch (error: any) {
    console.error("Error in invite-staff function:", error)
    return new Response(
      JSON.stringify({ error: error.message || "招待処理に失敗しました。" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
