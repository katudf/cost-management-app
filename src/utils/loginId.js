import { STAFF_ROLE, isAdminRole } from './constants';

/**
 * ログインID ⇔ Supabase Auth のメールアドレスの変換（docs/specs/login-id.md §3.1）。
 *
 * Supabase Auth はメールアドレスでしかログインできないため、ID を
 * `<ID>@login.invalid` という架空のメールアドレスに変換して使う。
 * `.invalid` は RFC 2606 で「決して存在しない」と定められたドメインなので、メールは届かない。
 *
 * 同じ規則を supabase/functions/manage-staff-login/handler.ts と SQL の login_id_email_domain() にも持っている。
 * 変えるときは3か所そろえること（一致は handler.test.ts と scripts/test-login-id-db.py が確かめる）。
 */

export const LOGIN_ID_EMAIL_DOMAIN = 'login.invalid';

/** ログインIDとして使える文字と長さ（半角英小文字・数字・_ - の3〜20文字） */
export const LOGIN_ID_PATTERN = /^[a-z0-9_-]{3,20}$/;

/** 管理者が発行・リセットするパスワードの最低文字数（Supabase Auth の Minimum password length とそろえる） */
export const LOGIN_PASSWORD_MIN_LENGTH = 8;

/** 入力されたIDを正規化する（前後の空白を除き、小文字にする） */
export const normalizeLoginId = (value) => String(value ?? '').trim().toLowerCase();

/** 正規化したうえで、ログインIDとして使える形式か */
export const isValidLoginId = (value) => LOGIN_ID_PATTERN.test(normalizeLoginId(value));

/** ログインID → Supabase Auth に渡すメールアドレス */
export const loginIdToEmail = (value) => `${normalizeLoginId(value)}@${LOGIN_ID_EMAIL_DOMAIN}`;

/** Supabase Auth のメールアドレス → ログインID（架空ドメインでなければ null） */
export const emailToLoginId = (email) => {
    const suffix = `@${LOGIN_ID_EMAIL_DOMAIN}`;
    const lower = String(email ?? '').toLowerCase();
    return lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : null;
};

/**
 * ログイン画面の入力を、signInWithPassword に渡すメールアドレスにする。
 * 移行期間（フェーズ1）は `@` を含む入力を従来のメールアドレスとしてそのまま使う。
 */
export const loginInputToEmail = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed.includes('@') ? trimmed : loginIdToEmail(trimmed);
};

/**
 * ログイン中の担当者が、対象の担当者のログイン（ID発行・リセット・ID変更・削除）を操作できるか。
 * admin は office / worker / viewer まで、admin / system_admin の行は system_admin だけ（決定 #5）。
 * サーバー側（Edge Function と RPC）でも同じ判定をしている。画面の出し分け用。
 */
export const canManageStaffLogin = (callerRole, targetRole) => {
    if (!isAdminRole(callerRole)) return false;
    if (isAdminRole(targetRole)) return callerRole === STAFF_ROLE.SYSTEM_ADMIN;
    return true;
};
