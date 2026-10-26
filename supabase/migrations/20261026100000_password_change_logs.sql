-- パスワード変更履歴。ユーザーがパスワードを変更したとき、日時と端末情報を記録し、
-- システム管理者 (system_admin) だけが設定タブで閲覧できるようにする。
-- 招待リンクからの初回設定は記録しない（フロント側で制御）。保持期間は無期限・削除なし。

-- システム管理者かどうか（RLS ポリシーと RPC で共通利用）
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid() AND role = 'system_admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_system_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS password_change_logs (
  id bigserial PRIMARY KEY,
  auth_user_id uuid,
  staff_id bigint,
  staff_name text,
  email text,
  -- 種別は src/utils/constants.js の PASSWORD_CHANGE_KIND と揃える
  kind text NOT NULL DEFAULT 'recovery' CHECK (kind IN ('recovery')),
  user_agent text,
  -- 表示用 IP（CF-Connecting-IP、なければ X-Forwarded-For の先頭）
  ip_address text,
  -- X-Forwarded-For の原文（先頭はクライアントが詐称できるため、経路確認用に残す）
  forwarded_for text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_change_logs_created_at_idx
  ON password_change_logs (created_at DESC);

ALTER TABLE password_change_logs ENABLE ROW LEVEL SECURITY;

-- 閲覧はシステム管理者のみ。INSERT は下の RPC（SECURITY DEFINER）経由のみで、
-- UPDATE / DELETE のポリシーは作らない（誰も変更・削除できない）。
DROP POLICY IF EXISTS password_change_logs_select_system_admin ON password_change_logs;
CREATE POLICY password_change_logs_select_system_admin ON password_change_logs
  FOR SELECT TO authenticated
  USING (public.is_system_admin());

-- 記録済みパスワードの指紋（ハッシュのハッシュ）。パスワードが実際に変わったときだけ
-- 記録するために使う。ポリシーは作らず RPC 経由でのみ読み書きする。
CREATE TABLE IF NOT EXISTS password_change_log_state (
  auth_user_id uuid PRIMARY KEY,
  password_fingerprint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE password_change_log_state ENABLE ROW LEVEL SECURITY;

-- パスワード変更直後にフロントから呼ぶ。日時はサーバー時刻、端末情報は
-- PostgREST が渡すリクエストヘッダー（User-Agent / CF-Connecting-IP / X-Forwarded-For）から取得する。
-- RPC を直接呼んでも偽の履歴が増えないよう、auth.users のパスワードハッシュが
-- 前回記録時から変わっている場合だけ記録する（初回は直近10分以内の更新に限る）。
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

  IF v_kind NOT IN ('recovery') THEN
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
    (auth_user_id, staff_id, staff_name, email, kind, user_agent, ip_address, forwarded_for)
  VALUES (
    v_uid,
    v_staff.id,
    v_staff.name,
    v_email,
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

-- 既読管理（ナビの未読バッジ用）。システム管理者ごとに既読にした時点を持つ。
-- ポリシーは作らず、下の RPC（SECURITY DEFINER）経由でのみ読み書きする。
CREATE TABLE IF NOT EXISTS password_change_log_reads (
  auth_user_id uuid PRIMARY KEY,
  last_read_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE password_change_log_reads ENABLE ROW LEVEL SECURITY;

-- 履歴を表示したときに呼ぶ。p_until（表示した中で最新の created_at）までを既読にする。
-- 取得後に追加された履歴を未読のまま残すため now() は使わず、既読時刻は後退させない。
DROP FUNCTION IF EXISTS public.mark_password_change_logs_read();
CREATE OR REPLACE FUNCTION public.mark_password_change_logs_read(p_until timestamptz)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_until IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO password_change_log_reads (auth_user_id, last_read_at)
  VALUES (auth.uid(), p_until)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET last_read_at = GREATEST(password_change_log_reads.last_read_at, EXCLUDED.last_read_at);
END;
$$;

-- 未読件数。システム管理者以外は常に 0。既読記録がなければ全件を未読とする。
CREATE OR REPLACE FUNCTION public.count_unread_password_change_logs()
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
BEGIN
  IF NOT public.is_system_admin() THEN
    RETURN 0;
  END IF;

  SELECT last_read_at INTO v_last
  FROM password_change_log_reads WHERE auth_user_id = auth.uid();

  RETURN (
    SELECT count(*)::integer FROM password_change_logs
    WHERE v_last IS NULL OR created_at > v_last
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_password_change_logs_read(timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_password_change_logs_read(timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.count_unread_password_change_logs() FROM public;
GRANT EXECUTE ON FUNCTION public.count_unread_password_change_logs() TO authenticated;
