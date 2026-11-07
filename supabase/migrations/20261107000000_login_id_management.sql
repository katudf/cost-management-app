-- =========================================================
-- 独自ログインIDへの切り替え（フェーズ1）  設計: docs/specs/login-id.md
--
-- ログインIDは Supabase Auth のメールアドレス `<ID>@login.invalid` として持つ（正は auth.users.email だけ）。
-- ID発行・パスワードリセット・ID変更・削除は Edge Function manage-staff-login が service_role で行い、
-- DB 側の更新と権限の再確認はここで作る service_role 専用 RPC で行う。
--
-- 1. 保護トリガー: 管理者の任命・解任、管理者の行の紐付け変更・削除を system_admin だけにする（決定 #11）。
--    ログインがある行（auth_user_id あり）は直接 DELETE できなくする（Auth ユーザーの取り残し防止）。
-- 2. 一覧・本人用のID取得 RPC
-- 3. Edge Function 専用 RPC（権限確認・紐付け・削除・管理者リセットの記録）
-- 4. パスワード変更履歴に種類（本人変更・管理者リセット）と操作者・ログインIDを追加
-- =========================================================

-- ---------- 1. 保護トリガー ----------
CREATE OR REPLACE FUNCTION public.protect_office_staff_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.bypass_staff_protect_trigger', true), 'off') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'system_admin' AND NOT is_system_admin() THEN
      RAISE EXCEPTION 'システム管理者はシステム管理者だけが追加できます。';
    END IF;
    IF NEW.role = 'admin' AND NOT is_system_admin() THEN
      RAISE EXCEPTION '管理者はシステム管理者だけが追加できます。';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'system_admin' AND NOT is_system_admin() THEN
      RAISE EXCEPTION 'システム管理者はシステム管理者だけが削除できます。';
    END IF;
    IF OLD.role = 'admin' AND NOT is_system_admin() THEN
      RAISE EXCEPTION '管理者はシステム管理者だけが削除できます。';
    END IF;
    -- ログインのある担当者は Edge Function（Auth ユーザーも一緒に消す）からだけ削除できる
    IF OLD.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'ログインIDのある担当者は、担当者設定の削除ボタンから削除してください。';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.is_approver IS DISTINCT FROM OLD.is_approver THEN
    IF NOT is_admin() THEN
      RAISE EXCEPTION 'role, auth_user_id, is_approver は管理者のみ変更できます。';
    END IF;
    -- システム管理者への昇格・システム管理者からの降格・システム管理者の行の付け替えは、システム管理者だけ
    IF (OLD.role = 'system_admin' OR NEW.role = 'system_admin') AND NOT is_system_admin() THEN
      RAISE EXCEPTION 'システム管理者の権限・紐付けはシステム管理者だけが変更できます。';
    END IF;
  END IF;
  -- 管理者への昇格・管理者からの降格・管理者の行の付け替えも、システム管理者だけ（決定 #11）。
  -- admin どうしで降格→パスワードリセット→成り代わり、ができないようにする。
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id)
     AND (OLD.role = 'admin' OR NEW.role = 'admin')
     AND NOT is_system_admin() THEN
    RAISE EXCEPTION '管理者の任命・解任と紐付けの変更は、システム管理者だけができます。';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_office_staff_privileged_columns() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_protect_office_staff_privileged_columns ON public.office_staff;
CREATE TRIGGER trg_protect_office_staff_privileged_columns
  BEFORE INSERT OR UPDATE OR DELETE ON public.office_staff
  FOR EACH ROW EXECUTE FUNCTION public.protect_office_staff_privileged_columns();

-- ---------- 2. ID取得 RPC ----------
-- 架空メールのドメイン。SQL 側はこの関数だけに書く。
-- src/utils/loginId.js / supabase/functions/manage-staff-login/handler.ts の LOGIN_ID_EMAIL_DOMAIN とそろえる
-- （一致は scripts/test-login-id-db.py と handler.test.ts で確かめている）。
CREATE OR REPLACE FUNCTION public.login_id_email_domain()
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT 'login.invalid'::text; $$;

CREATE OR REPLACE FUNCTION public.login_id_from_email(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN right(lower(p_email), length(public.login_id_email_domain()) + 1) = '@' || public.login_id_email_domain()
      THEN left(lower(p_email), length(p_email) - length(public.login_id_email_domain()) - 1)
    ELSE NULL
  END;
$$;

-- 担当者一覧用。管理者以外は0件。
--   login_id     : 割り当て済みのID（未割り当てなら NULL）
--   legacy_email : 移行前のメールアドレス（フェーズ1で誰を移行するか見分けるため。割り当て済みなら NULL）
CREATE OR REPLACE FUNCTION public.get_office_staff_login_ids()
RETURNS TABLE (staff_id bigint, login_id text, legacy_email text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id,
         public.login_id_from_email(u.email),
         CASE WHEN public.login_id_from_email(u.email) IS NULL THEN u.email::text END
  FROM office_staff s
  JOIN auth.users u ON u.id = s.auth_user_id
  WHERE is_admin();
$$;

REVOKE EXECUTE ON FUNCTION public.get_office_staff_login_ids() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_office_staff_login_ids() TO authenticated;

-- 本人用（自分のIDの表示）
CREATE OR REPLACE FUNCTION public.get_my_login_id()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.login_id_from_email(email) FROM auth.users WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_login_id() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_login_id() TO authenticated;

-- ---------- 4. パスワード変更履歴 ----------
-- （3 の RPC が使うので先に列を足す）
ALTER TABLE password_change_logs ADD COLUMN IF NOT EXISTS operator_staff_id bigint;
ALTER TABLE password_change_logs ADD COLUMN IF NOT EXISTS operator_staff_name text;
ALTER TABLE password_change_logs ADD COLUMN IF NOT EXISTS login_id text;

ALTER TABLE password_change_logs DROP CONSTRAINT IF EXISTS password_change_logs_kind_check;
ALTER TABLE password_change_logs ADD CONSTRAINT password_change_logs_kind_check
  CHECK (kind IN ('recovery', 'self', 'admin_reset'));

-- 本人による変更の記録（recovery = メール再設定、self = ログイン中の本人変更）。
-- admin_reset はクライアントから記録できない（下の log_admin_password_reset を使う）。
CREATE OR REPLACE FUNCTION public.log_password_change(p_kind text DEFAULT 'recovery')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := COALESCE(NULLIF(p_kind, ''), 'recovery');
  v_headers json;
  v_staff office_staff%ROWTYPE;
  v_email text;
  v_user_updated_at timestamptz;
  v_fingerprint text;
  v_prev_fingerprint text;
  v_xff text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_kind NOT IN ('recovery', 'self') THEN
    RAISE EXCEPTION 'invalid password change kind: %', v_kind;
  END IF;

  SELECT email,
         updated_at,
         encode(sha256(convert_to(COALESCE(encrypted_password, ''), 'UTF8')), 'hex')
    INTO v_email, v_user_updated_at, v_fingerprint
  FROM auth.users WHERE id = v_uid;

  SELECT password_fingerprint INTO v_prev_fingerprint
  FROM password_change_log_state WHERE auth_user_id = v_uid;

  IF FOUND THEN
    -- パスワードが前回記録時から変わっていなければ記録しない
    IF v_prev_fingerprint = v_fingerprint THEN
      RETURN;
    END IF;
  ELSIF v_user_updated_at IS NULL OR v_user_updated_at < now() - interval '10 minutes' THEN
    RETURN;
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  v_xff := NULLIF(trim(COALESCE(v_headers ->> 'x-forwarded-for', '')), '');

  SELECT * INTO v_staff FROM office_staff WHERE auth_user_id = v_uid LIMIT 1;

  INSERT INTO password_change_logs
    (auth_user_id, staff_id, staff_name, email, login_id, kind, user_agent, ip_address, forwarded_for)
  VALUES (
    v_uid,
    v_staff.id,
    v_staff.name,
    v_email,
    public.login_id_from_email(v_email),
    v_kind,
    v_headers ->> 'user-agent',
    COALESCE(
      NULLIF(trim(COALESCE(v_headers ->> 'cf-connecting-ip', '')), ''),
      NULLIF(trim(split_part(COALESCE(v_xff, ''), ',', 1)), '')
    ),
    v_xff
  );

  INSERT INTO password_change_log_state (auth_user_id, password_fingerprint, updated_at)
  VALUES (v_uid, v_fingerprint, now())
  ON CONFLICT (auth_user_id) DO UPDATE
    SET password_fingerprint = EXCLUDED.password_fingerprint,
        updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.log_password_change(text) FROM public;
GRANT EXECUTE ON FUNCTION public.log_password_change(text) TO authenticated;

-- ---------- 3. Edge Function 専用 RPC ----------
-- 呼び出し元（p_caller = Edge Function が JWT から確かめた auth.users.id）が、対象の担当者のログインを
-- 操作できるかを確かめ、対象の行を返す。admin は office / worker / viewer まで、
-- admin / system_admin の行は system_admin だけ（決定 #5）。p_lock = true なら行ロックを取る。
CREATE OR REPLACE FUNCTION public.assert_can_manage_staff_login(p_caller uuid, p_staff_id bigint, p_lock boolean DEFAULT false)
RETURNS office_staff
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target office_staff%ROWTYPE;
BEGIN
  SELECT role INTO v_caller_role FROM office_staff WHERE auth_user_id = p_caller;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'system_admin') THEN
    RAISE EXCEPTION 'この操作には管理者権限が必要です。' USING ERRCODE = '42501';
  END IF;

  IF p_lock THEN
    SELECT * INTO v_target FROM office_staff WHERE id = p_staff_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM office_staff WHERE id = p_staff_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の担当者が見つかりません。' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.role IN ('admin', 'system_admin') AND v_caller_role <> 'system_admin' THEN
    RAISE EXCEPTION '管理者・システム管理者のログインは、システム管理者だけが操作できます。' USING ERRCODE = '42501';
  END IF;

  RETURN v_target;
END;
$$;

-- パスワード指紋（password_change_log_state）を今のパスワードにそろえる。
-- 管理者が設定したパスワードのあとに、本人が log_password_change('self') を呼んで
-- 偽の「本人変更」を記録できないようにする。
CREATE OR REPLACE FUNCTION public.sync_password_fingerprint(p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO password_change_log_state (auth_user_id, password_fingerprint, updated_at)
  SELECT id, encode(sha256(convert_to(COALESCE(encrypted_password, ''), 'UTF8')), 'hex'), now()
  FROM auth.users WHERE id = p_auth_user_id
  ON CONFLICT (auth_user_id) DO UPDATE
    SET password_fingerprint = EXCLUDED.password_fingerprint,
        updated_at = EXCLUDED.updated_at;
$$;

-- ID発行（create）で作った Auth ユーザーを担当者に紐付ける。権限を行ロック付きで確かめ直す。
CREATE OR REPLACE FUNCTION public.link_staff_login(p_caller uuid, p_staff_id bigint, p_auth_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target office_staff%ROWTYPE;
BEGIN
  v_target := public.assert_can_manage_staff_login(p_caller, p_staff_id, true);
  IF v_target.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'この担当者には既にログインがあります。' USING ERRCODE = '23505';
  END IF;

  PERFORM set_config('app.bypass_staff_protect_trigger', 'on', true);
  UPDATE office_staff SET auth_user_id = p_auth_user_id WHERE id = p_staff_id;
  PERFORM set_config('app.bypass_staff_protect_trigger', 'off', true);

  PERFORM public.sync_password_fingerprint(p_auth_user_id);
END;
$$;

-- 担当者の行を削除し、紐付いていた Auth ユーザーの ID を返す（Edge Function が続けて Auth ユーザーを消す）。
CREATE OR REPLACE FUNCTION public.delete_staff_with_login(p_caller uuid, p_staff_id bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target office_staff%ROWTYPE;
BEGIN
  v_target := public.assert_can_manage_staff_login(p_caller, p_staff_id, true);
  IF v_target.auth_user_id = p_caller THEN
    RAISE EXCEPTION '自分自身は削除できません。' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.bypass_staff_protect_trigger', 'on', true);
  DELETE FROM office_staff WHERE id = p_staff_id;
  PERFORM set_config('app.bypass_staff_protect_trigger', 'off', true);

  RETURN v_target.auth_user_id;
END;
$$;

-- 管理者によるパスワード設定（リセット・ID割り当て時の設定）を履歴に残し、指紋をそろえる。
CREATE OR REPLACE FUNCTION public.log_admin_password_reset(
  p_caller uuid,
  p_staff_id bigint,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_forwarded_for text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target office_staff%ROWTYPE;
  v_operator office_staff%ROWTYPE;
  v_email text;
BEGIN
  v_target := public.assert_can_manage_staff_login(p_caller, p_staff_id, false);
  SELECT * INTO v_operator FROM office_staff WHERE auth_user_id = p_caller LIMIT 1;
  SELECT email INTO v_email FROM auth.users WHERE id = v_target.auth_user_id;

  INSERT INTO password_change_logs
    (auth_user_id, staff_id, staff_name, email, login_id, kind,
     operator_staff_id, operator_staff_name, user_agent, ip_address, forwarded_for)
  VALUES (
    v_target.auth_user_id, v_target.id, v_target.name, v_email, public.login_id_from_email(v_email), 'admin_reset',
    v_operator.id, v_operator.name, p_user_agent, p_ip_address, p_forwarded_for
  );

  PERFORM public.sync_password_fingerprint(v_target.auth_user_id);
END;
$$;

-- Edge Function（service_role）専用。ブラウザからは呼べない。
REVOKE EXECUTE ON FUNCTION public.assert_can_manage_staff_login(uuid, bigint, boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_password_fingerprint(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_staff_login(uuid, bigint, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_staff_with_login(uuid, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_admin_password_reset(uuid, bigint, text, text, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_can_manage_staff_login(uuid, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_password_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_staff_login(uuid, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_staff_with_login(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_admin_password_reset(uuid, bigint, text, text, text) TO service_role;
