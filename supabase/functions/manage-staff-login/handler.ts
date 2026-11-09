// manage-staff-login の処理本体（設計: docs/specs/login-id.md §5）。
// Deno 固有の API に依存しないようにして、Vitest（handler.test.ts）から偽のクライアントでテストできるようにしている。
// HTTP の受け口・呼び出し元の認証は index.ts。

// src/utils/loginId.js とそろえる（scripts/test-login-id-db.py が SQL の login_id_email_domain() とも一致を確かめる）
export const LOGIN_ID_EMAIL_DOMAIN = 'login.invalid'
const LOGIN_ID_PATTERN = /^[a-z0-9_-]{3,20}$/
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 72 // bcrypt の上限
// 削除時に先にログインを止めるための BAN 期間（実質無期限）
const BAN_FOREVER = '876000h'

export const normalizeLoginId = (value: unknown) => String(value ?? '').trim().toLowerCase()
export const loginIdToEmail = (loginId: string) => `${loginId}@${LOGIN_ID_EMAIL_DOMAIN}`
export const isLoginIdEmail = (email: string | undefined | null) =>
  String(email ?? '').toLowerCase().endsWith(`@${LOGIN_ID_EMAIL_DOMAIN}`)

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

type ErrorLike = { code?: string; status?: number; message?: string } | null | undefined

export const parseLoginId = (value: unknown) => {
  const loginId = normalizeLoginId(value)
  if (!LOGIN_ID_PATTERN.test(loginId)) {
    throw new HttpError(400, "ログインIDは半角英小文字・数字・「_」「-」の3〜20文字で入力してください。")
  }
  return loginId
}

export const parsePassword = (value: unknown) => {
  const password = typeof value === 'string' ? value : ''
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new HttpError(400, `パスワードは${PASSWORD_MIN_LENGTH}〜${PASSWORD_MAX_LENGTH}文字で入力してください。`)
  }
  return password
}

// DB の RPC が投げた例外を HTTP ステータスに変える（メッセージは日本語でそのまま画面に出す）
export const rpcError = (error: ErrorLike) => {
  const code = error?.code
  const status = code === '42501' ? 403 : code === 'P0002' ? 404 : code === '23505' ? 409 : 500
  return new HttpError(status, error?.message || "処理に失敗しました。")
}

// Auth の「メールアドレスが既にある」エラーをIDの重複として返す。
// 既存の Auth ユーザーへの紐付けはしない（第三者が先に作ったユーザーに権限を渡さないため）。
export const authError = (error: ErrorLike) => {
  if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
    return new HttpError(409, "このログインIDは既に使われています。別のIDを指定してください。")
  }
  if (error?.code === 'weak_password') {
    return new HttpError(400, "パスワードが短すぎるか、弱すぎます。")
  }
  return new HttpError(500, error?.message || "ログイン情報の更新に失敗しました。")
}

type AuthUser = { id: string; email?: string | null; last_sign_in_at?: string | null }
type Result<T> = Promise<{ data: T; error: ErrorLike }>

/** service_role のクライアントのうち、この処理が使う部分だけ（テストでは偽物を渡す） */
export interface AdminClient {
  rpc(fn: string, args: Record<string, unknown>): Result<unknown>
  auth: {
    admin: {
      createUser(attrs: Record<string, unknown>): Result<{ user: AuthUser | null } | null>
      getUserById(id: string): Result<{ user: AuthUser | null } | null>
      updateUserById(id: string, attrs: Record<string, unknown>): Result<unknown>
      deleteUser(id: string): Result<unknown>
    }
  }
}

export type RequestMeta = { userAgent: string | null; ipAddress: string | null; forwardedFor: string | null }

type StaffRow = { id: number; name: string; role: string; auth_user_id: string | null }

// 権限確認の RPC を呼び、対象の行を返す（担当者: assert_can_manage_staff_login、作業員: assert_can_manage_worker_login など）
const assertVia = async <T>(admin: AdminClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(fn, { ...args, p_lock: false })
  if (error) throw rpcError(error)
  return data as T
}

const assertCanManage = (admin: AdminClient, callerId: string, staffId: number) =>
  assertVia<StaffRow>(admin, 'assert_can_manage_staff_login', { p_caller: callerId, p_staff_id: staffId })

/**
 * Auth を書き換えたあとに、権限をもう一度確かめる。確認から書き換えまでの間に対象の役割が変わった
 * （例: 事務が管理者に昇格した）場合に、業務管理者が管理者のログインを書き換えたままにしないため。
 * 失敗したら undo で Auth の変更を戻し、403 を返す。担当者・作業員で共通（fn に権限確認の RPC を渡す）。
 */
const recheckOrUndo = async (
  admin: AdminClient, fn: string, args: Record<string, unknown>, undo: () => Promise<void>,
) => {
  const { error } = await admin.rpc(fn, { ...args, p_lock: false })
  if (!error) return
  try {
    await undo()
  } catch (undoError) {
    console.error("undo after failed recheck failed:", undoError)
  }
  throw rpcError(error)
}

const logAdminPasswordReset = async (admin: AdminClient, meta: RequestMeta, callerId: string, staffId: number) => {
  const { error } = await admin.rpc('log_admin_password_reset', {
    p_caller: callerId,
    p_staff_id: staffId,
    p_user_agent: meta.userAgent,
    p_ip_address: meta.ipAddress,
    p_forwarded_for: meta.forwardedFor,
  })
  return error
}

/** body.target が 'worker' なら作業員（docs/specs/worker-login.md §5）、それ以外は担当者 */
export async function handleAction(
  admin: AdminClient,
  callerId: string,
  body: Record<string, unknown>,
  meta: RequestMeta,
): Promise<Record<string, unknown>> {
  if (body?.target === 'worker') return handleWorkerAction(admin, callerId, body, meta)
  return handleStaffAction(admin, callerId, body, meta)
}

// その Auth ユーザーが作業員にも紐付いているか（担当者兼作業員。worker-login.md 決定 #7）
const linkedWorkerId = async (admin: AdminClient, authUserId: string) => {
  const { data, error } = await admin.rpc('worker_id_for_auth_user', { p_auth_user_id: authUserId })
  if (error) throw rpcError(error)
  return (data as number | null) ?? null
}

// その Auth ユーザーが担当者にも紐付いているか
const linkedStaffId = async (admin: AdminClient, authUserId: string) => {
  const { data, error } = await admin.rpc('staff_id_for_auth_user', { p_auth_user_id: authUserId })
  if (error) throw rpcError(error)
  return (data as number | null) ?? null
}

async function handleStaffAction(
  admin: AdminClient,
  callerId: string,
  body: Record<string, unknown>,
  meta: RequestMeta,
): Promise<Record<string, unknown>> {
  const action = body?.action
  const staffId = Number(body?.staffId)
  if (!Number.isInteger(staffId) || staffId <= 0) throw new HttpError(400, "staffId が正しくありません。")

  // 権限の確認（操作できない行ならここで 403）
  const target = await assertCanManage(admin, callerId, staffId)

  switch (action) {
    case 'create': {
      if (target.auth_user_id) throw new HttpError(409, "この担当者には既にログインがあります。")
      const loginId = parseLoginId(body.loginId)
      const password = parsePassword(body.password)

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: loginIdToEmail(loginId),
        password,
        email_confirm: true,
        app_metadata: { office_staff_id: staffId },
      })
      if (createError || !created?.user) throw authError(createError)

      // 紐付けの RPC の中で権限を行ロック付きで確かめ直す
      const { error: linkError } = await admin.rpc('link_staff_login', {
        p_caller: callerId,
        p_staff_id: staffId,
        p_auth_user_id: created.user.id,
      })
      if (linkError) {
        // 紐付けに失敗したら作った Auth ユーザーを消し、IDを空けておく
        const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id)
        if (rollbackError) console.error("rollback deleteUser failed:", rollbackError)
        throw rpcError(linkError)
      }
      return { success: true, loginId }
    }

    case 'assign_login_id': {
      if (!target.auth_user_id) throw new HttpError(400, "この担当者にはログインがありません。「ID発行」を使ってください。")
      const authUserId = target.auth_user_id
      const loginId = parseLoginId(body.loginId)
      const password = body.password ? parsePassword(body.password) : null

      const { data: current, error: getError } = await admin.auth.admin.getUserById(authUserId)
      if (getError || !current?.user) throw authError(getError)
      const previousEmail = current.user.email
      if (isLoginIdEmail(previousEmail)) {
        throw new HttpError(409, "この担当者には既にログインIDがあります。変更は「ID変更」を使ってください。")
      }
      // 招待に応じていない（一度もログインしていない）人はパスワードが無いので、ここで決めてもらう
      if (!password && !current.user.last_sign_in_at) {
        throw new HttpError(400, "この担当者はまだパスワードを設定していません。パスワードも入力してください。")
      }

      // ID の割り当て（メールの書き換え）とパスワードの設定を分けて行い、権限の再確認で戻せる範囲を広げる
      const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, {
        email: loginIdToEmail(loginId),
        email_confirm: true,
      })
      if (updateError) throw authError(updateError)
      await recheckOrUndo(admin, 'assert_can_manage_staff_login', { p_caller: callerId, p_staff_id: staffId }, async () => {
        await admin.auth.admin.updateUserById(authUserId, { email: previousEmail, email_confirm: true })
      })

      let logged: boolean | null = null
      if (password) {
        const { error: passwordError } = await admin.auth.admin.updateUserById(authUserId, { password })
        if (passwordError) {
          throw new HttpError(authError(passwordError).status,
            `ログインID「${loginId}」は割り当てましたが、パスワードの設定に失敗しました。パスワードリセットからやり直してください。`)
        }
        // 履歴の記録 RPC も中で権限を確かめ直す。記録に失敗してもパスワードは変わっているので失敗にはしない
        const logError = await logAdminPasswordReset(admin, meta, callerId, staffId)
        if (logError) console.error("log_admin_password_reset failed:", logError)
        logged = !logError
      }
      return { success: true, loginId, logged }
    }

    case 'reset_password': {
      if (!target.auth_user_id) throw new HttpError(400, "この担当者にはログインがありません。")
      const password = parsePassword(body.password)

      const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, { password })
      if (updateError) throw authError(updateError)

      // 記録の RPC は中で権限を確かめ直す。権限が無くなっていた（確認の直後に対象が管理者に昇格した）場合は
      // パスワードは戻せないので、システム管理者に再リセットを促すエラーにする
      const logError = await logAdminPasswordReset(admin, meta, callerId, staffId)
      if (logError?.code === '42501') {
        console.error("permission changed during reset_password:", logError)
        throw new HttpError(403,
          "操作中に対象の権限が変わりました。パスワードは変更されています。システム管理者がもう一度リセットしてください。")
      }
      if (logError) console.error("log_admin_password_reset failed:", logError)
      return { success: true, logged: !logError }
    }

    case 'change_login_id': {
      if (!target.auth_user_id) throw new HttpError(400, "この担当者にはログインがありません。")
      const authUserId = target.auth_user_id
      const loginId = parseLoginId(body.loginId)

      const { data: current, error: getError } = await admin.auth.admin.getUserById(authUserId)
      if (getError || !current?.user) throw authError(getError)
      const previousEmail = current.user.email
      if (!isLoginIdEmail(previousEmail)) {
        throw new HttpError(400, "この担当者にはまだログインIDがありません。「ID割り当て」を使ってください。")
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, {
        email: loginIdToEmail(loginId),
        email_confirm: true,
      })
      if (updateError) throw authError(updateError)
      await recheckOrUndo(admin, 'assert_can_manage_staff_login', { p_caller: callerId, p_staff_id: staffId }, async () => {
        await admin.auth.admin.updateUserById(authUserId, { email: previousEmail, email_confirm: true })
      })
      return { success: true, loginId }
    }

    case 'delete': {
      const authUserId = target.auth_user_id
      // 自分自身は削除できない（RPC でも弾くが、その前に自分を BAN しないよう先に止める）
      if (authUserId && authUserId === callerId) throw new HttpError(403, "自分自身は削除できません。")
      // 作業員にも紐付いたログイン（担当者兼作業員）は、作業員として使い続けるので止めも消しもしない。
      // 担当者の行だけを消す（Auth を消すと作業員側のログインが黙って外れるため）。
      if (authUserId && await linkedWorkerId(admin, authUserId)) {
        const { error: deleteError } = await admin.rpc('delete_staff_with_login', {
          p_caller: callerId,
          p_staff_id: staffId,
        })
        if (deleteError) throw rpcError(deleteError)
        return { success: true, keptWorkerLogin: true }
      }
      // 先にログインを止める（BAN）。行を消したあとで Auth ユーザーの削除に失敗しても、
      // 担当者のいないログインが使える状態で残らないようにする。
      if (authUserId) {
        const { error: banError } = await admin.auth.admin.updateUserById(authUserId, { ban_duration: BAN_FOREVER })
        if (banError) throw authError(banError)
      }

      // 行の削除。RPC の中で権限を行ロック付きで確かめ直す
      const { error: deleteError } = await admin.rpc('delete_staff_with_login', {
        p_caller: callerId,
        p_staff_id: staffId,
      })
      if (deleteError) {
        if (authUserId) {
          const { error: unbanError } = await admin.auth.admin.updateUserById(authUserId, { ban_duration: 'none' })
          if (unbanError) console.error("unban after failed delete failed:", unbanError)
        }
        throw rpcError(deleteError)
      }

      if (authUserId) {
        const { error: authDeleteError } = await admin.auth.admin.deleteUser(authUserId)
        if (authDeleteError) {
          console.error("deleteUser failed after staff row deletion:", authDeleteError)
          throw new HttpError(500,
            "担当者は削除し、ログインも停止しましたが、ログインの削除に失敗しました。Supabase の管理画面（Authentication → Users）で該当ユーザーを削除してください。")
        }
      }
      return { success: true }
    }

    default:
      throw new HttpError(400, "action が正しくありません。")
  }
}

// ======================================================================
// 作業員のログイン（docs/specs/worker-login.md §5）
// ======================================================================

type WorkerRow = { id: number; name: string; auth_user_id: string | null }

const assertCanManageWorker = (admin: AdminClient, callerId: string, workerId: number) =>
  assertVia<WorkerRow>(admin, 'assert_can_manage_worker_login', { p_caller: callerId, p_worker_id: workerId })

const ban = async (admin: AdminClient, authUserId: string) => {
  const { error } = await admin.auth.admin.updateUserById(authUserId, { ban_duration: BAN_FOREVER })
  if (error) throw authError(error)
}

const unbanQuietly = async (admin: AdminClient, authUserId: string) => {
  const { error } = await admin.auth.admin.updateUserById(authUserId, { ban_duration: 'none' })
  if (error) console.error("unban failed:", error)
}

async function handleWorkerAction(
  admin: AdminClient,
  callerId: string,
  body: Record<string, unknown>,
  meta: RequestMeta,
): Promise<Record<string, unknown>> {
  const action = body?.action
  const workerId = Number(body?.workerId)
  if (!Number.isInteger(workerId) || workerId <= 0) throw new HttpError(400, "workerId が正しくありません。")

  // 退職日に合わせた BAN は事務も呼べる（退職日は事務も保存できるため）。権限の確認は RPC の中。
  // BAN するかどうかは呼び出し元から受け取らず、DB の退職日だけで決める。
  if (action === 'sync_ban') {
    const { data, error } = await admin.rpc('worker_ban_state', { p_caller: callerId, p_worker_id: workerId })
    if (error) throw rpcError(error)
    const state = (Array.isArray(data) ? data[0] : data) as
      { auth_user_id: string | null; should_ban: boolean; shared: boolean } | undefined
    // ログインが無い・担当者と共有（担当者としては使い続ける）なら何もしない
    if (!state?.auth_user_id || state.shared) return { success: true, banned: null }
    const { error: banError } = await admin.auth.admin.updateUserById(state.auth_user_id, {
      ban_duration: state.should_ban ? BAN_FOREVER : 'none',
    })
    if (banError) throw authError(banError)
    return { success: true, banned: state.should_ban }
  }

  // 作業員の削除は事務もできる（作業員マスタの削除と同じ）。それ以外の操作は管理者だけ
  const target = action === 'delete'
    ? await assertVia<WorkerRow>(admin, 'assert_can_delete_worker', { p_caller: callerId, p_worker_id: workerId })
    : await assertCanManageWorker(admin, callerId, workerId)

  switch (action) {
    case 'create': {
      if (target.auth_user_id) throw new HttpError(409, "この作業員には既にログインがあります。")
      const loginId = parseLoginId(body.loginId)
      const password = parsePassword(body.password)

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: loginIdToEmail(loginId),
        password,
        email_confirm: true,
        app_metadata: { worker_id: workerId },
      })
      if (createError || !created?.user) throw authError(createError)

      const { error: linkError } = await admin.rpc('link_worker_login', {
        p_caller: callerId,
        p_worker_id: workerId,
        p_auth_user_id: created.user.id,
      })
      if (linkError) {
        const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id)
        if (rollbackError) console.error("rollback deleteUser failed:", rollbackError)
        throw rpcError(linkError)
      }
      return { success: true, loginId }
    }

    case 'link_staff_account': {
      const staffId = Number(body?.staffId)
      if (!Number.isInteger(staffId) || staffId <= 0) throw new HttpError(400, "staffId が正しくありません。")
      // 対象の担当者の制限（office 以上・ログインIDあり・未紐付け）は RPC の中で確かめる
      const { error } = await admin.rpc('link_worker_to_staff_login', {
        p_caller: callerId,
        p_worker_id: workerId,
        p_staff_id: staffId,
      })
      if (error) throw rpcError(error)
      return { success: true }
    }

    case 'reset_password': {
      if (!target.auth_user_id) throw new HttpError(400, "この作業員にはログインがありません。")
      const password = parsePassword(body.password)

      const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, { password })
      if (updateError) throw authError(updateError)

      const { error: logError } = await admin.rpc('log_admin_worker_password_reset', {
        p_caller: callerId,
        p_worker_id: workerId,
        p_user_agent: meta.userAgent,
        p_ip_address: meta.ipAddress,
        p_forwarded_for: meta.forwardedFor,
      })
      if (logError?.code === '42501') {
        console.error("permission changed during worker reset_password:", logError)
        throw new HttpError(403,
          "操作中に対象の権限が変わりました。パスワードは変更されています。システム管理者がもう一度リセットしてください。")
      }
      if (logError) console.error("log_admin_worker_password_reset failed:", logError)
      return { success: true, logged: !logError }
    }

    case 'change_login_id': {
      if (!target.auth_user_id) throw new HttpError(400, "この作業員にはログインがありません。")
      const authUserId = target.auth_user_id
      const loginId = parseLoginId(body.loginId)

      const { data: current, error: getError } = await admin.auth.admin.getUserById(authUserId)
      if (getError || !current?.user) throw authError(getError)
      const previousEmail = current.user.email

      const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, {
        email: loginIdToEmail(loginId),
        email_confirm: true,
      })
      if (updateError) throw authError(updateError)
      await recheckOrUndo(admin, 'assert_can_manage_worker_login', { p_caller: callerId, p_worker_id: workerId }, async () => {
        await admin.auth.admin.updateUserById(authUserId, { email: previousEmail, email_confirm: true })
      })
      return { success: true, loginId }
    }

    case 'unlink':
    case 'delete': {
      const authUserId = target.auth_user_id
      if (action === 'unlink' && !authUserId) throw new HttpError(400, "この作業員にはログインがありません。")
      if (authUserId && authUserId === callerId) {
        throw new HttpError(403, action === 'delete' ? "自分自身は削除できません。" : "自分自身のログインは外せません。")
      }
      // 担当者と共有のログインは、担当者として使い続けるので止めも消しもしない（紐付けだけ外れる）
      const shared = authUserId ? (await linkedStaffId(admin, authUserId)) !== null : false
      // 先にログインを止める（行の更新・削除のあとで Auth の削除に失敗しても、使えるログインを残さない）
      if (authUserId && !shared) await ban(admin, authUserId)

      const { error: rpcErr } = await admin.rpc(action === 'delete' ? 'delete_worker_with_login' : 'unlink_worker_login', {
        p_caller: callerId,
        p_worker_id: workerId,
      })
      if (rpcErr) {
        if (authUserId && !shared) await unbanQuietly(admin, authUserId)
        throw rpcError(rpcErr)
      }

      if (authUserId && !shared) {
        const { error: authDeleteError } = await admin.auth.admin.deleteUser(authUserId)
        if (authDeleteError) {
          console.error("deleteUser failed after worker unlink/delete:", authDeleteError)
          throw new HttpError(500,
            "ログインは停止しましたが、ログインの削除に失敗しました。Supabase の管理画面（Authentication → Users）で該当ユーザーを削除してください。")
        }
      }
      return { success: true, keptStaffLogin: shared }
    }

    default:
      throw new HttpError(400, "action が正しくありません。")
  }
}
