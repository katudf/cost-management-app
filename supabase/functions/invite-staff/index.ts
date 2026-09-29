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

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // 呼び出し元がadminロールであることを確認（招待は管理者のみ許可）
    const { data: callerStaff, error: callerStaffError } = await adminClient
      .from('office_staff')
      .select('role')
      .eq('auth_user_id', callerData.user.id)
      .maybeSingle()

    if (callerStaffError) throw callerStaffError
    if (!callerStaff || callerStaff.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: "この操作には管理者権限が必要です。" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { staffId, email, redirectTo } = await req.json()
    if (!staffId || !email) {
      return new Response(
        JSON.stringify({ error: "staffIdとemailは必須です。" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

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

    // 招待メールのリンク先。指定しないと Supabase Auth の Site URL が使われるため、
    // 招待操作をした画面のURLを受け取って渡す（http/https 以外は無視）。
    // なお Supabase 側の Redirect URLs 許可リストに無いURLは Site URL にフォールバックされる。
    let safeRedirectTo: string | undefined
    if (typeof redirectTo === 'string') {
      try {
        const url = new URL(redirectTo)
        if (url.protocol === 'https:' || url.protocol === 'http:') safeRedirectTo = url.toString()
      } catch {
        // 不正なURLは無視して Site URL に任せる
      }
    }

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { office_staff_id: staffRow.id, office_staff_name: staffRow.name },
      redirectTo: safeRedirectTo,
    })

    let newAuthUserId = inviteData?.user?.id

    if (inviteError) {
      // 既にこのメールアドレスでAuthユーザーが存在する場合（過去の招待で作成済みだが、
      // office_staff.auth_user_id の紐付けが何らかの理由で未完了の状態）は、
      // エラーにせず既存のAuthユーザーを探して紐付けを試みる。
      if (inviteError.code === 'email_exists') {
        // listUsersはページネーションされるため、全ページを走査して対象メールを探す
        let existingUser: { id: string; email?: string } | undefined
        for (let page = 1; page <= 20 && !existingUser; page++) {
          const { data: existingUsers, error: listError } =
            await adminClient.auth.admin.listUsers({ page, perPage: 200 })
          if (listError) throw listError

          existingUser = existingUsers?.users?.find(
            (u) => u.email?.toLowerCase() === email.toLowerCase()
          )

          if (!existingUsers?.users || existingUsers.users.length < 200) break
        }

        if (!existingUser) {
          // Authには存在すると言われたのに見つからない場合は素直にエラーにする
          throw inviteError
        }

        newAuthUserId = existingUser.id
      } else if (inviteError.code === 'over_email_send_rate_limit' || inviteError.status === 429) {
        return new Response(
          JSON.stringify({ error: "招待メールの送信回数が上限に達しました。しばらく待ってから再試行してください。" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      } else {
        throw inviteError
      }
    }

    if (!newAuthUserId) {
      throw new Error("招待ユーザーの作成に失敗しました。")
    }

    // 既存Authユーザーが別の担当者に紐付いている場合（同じメールアドレスを別の担当者で使っている等）は、
    // auth_user_id の一意制約違反になるため、紐付け前に検出して分かりやすいエラーを返す。
    const { data: linkedStaff, error: linkedStaffError } = await adminClient
      .from('office_staff')
      .select('id, name')
      .eq('auth_user_id', newAuthUserId)
      .neq('id', staffRow.id)
      .maybeSingle()

    if (linkedStaffError) throw linkedStaffError
    if (linkedStaff) {
      return new Response(
        JSON.stringify({ error: `このメールアドレスは既に担当者「${linkedStaff.name}」のログインに使われています。別のメールアドレスを指定してください。` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { error: linkError } = await adminClient.rpc('link_office_staff_auth_user', {
      p_staff_id: staffRow.id,
      p_auth_user_id: newAuthUserId,
    })

    if (linkError) {
      // 上のチェックと同時に別の招待が走った場合の一意制約違反
      if (linkError.code === '23505') {
        return new Response(
          JSON.stringify({ error: "このメールアドレスは既に別の担当者のログインに使われています。" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
      throw linkError
    }

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
