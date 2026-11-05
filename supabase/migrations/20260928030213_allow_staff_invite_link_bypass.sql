-- 前回の修正 (link_office_staff_auth_user RPCの新設) では
-- SECURITY DEFINER でもトリガー実行自体は回避できず、
-- trg_protect_office_staff_privileged_columns トリガー内の is_admin() が
-- auth.uid() = NULL (service_role実行のため) で false を返し、
-- 「role, auth_user_id, is_approver は管理者のみ変更できます。」で
-- 引き続き 500 エラーになっていた（execute_sql での直接再現で確認済み）。
--
-- SECURITY DEFINER 関数の中身のUPDATEは、テーブルの BEFORE UPDATE トリガーを
-- 素通りできない。かつ auth.uid() はセッションのJWTクレームに基づくため、
-- SECURITY DEFINER にしても NULL のまま変わらない。
--
-- 対応: link_office_staff_auth_user 関数内でのみ、そのUPDATE文の直前に
-- トランザクションローカル設定 (set_config の第3引数 true = is_local) で
-- 一時フラグを立て、トリガー側でそのフラグが立っている場合のみ
-- 管理者チェックをスキップする。フラグはトランザクション終了時に自動的に
-- 消えるため、他のセッションや後続のUPDATEには一切影響しない。
-- また、このフラグはこの特定のRPC関数内でしか立てられない
-- （EXECUTE権限は既にanon/authenticated/PUBLICから剥奪済み）ため、
-- 「管理者以外はrole/auth_user_id/is_approverを変更できない」という
-- トリガーの基本ルールは、他の経路（直接UPDATEやRLS越しの操作）に対しては
-- 従来通り維持される。

CREATE OR REPLACE FUNCTION public.protect_office_staff_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() AND coalesce(current_setting('app.bypass_staff_protect_trigger', true), 'off') <> 'on' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.is_approver IS DISTINCT FROM OLD.is_approver THEN
      RAISE EXCEPTION 'role, auth_user_id, is_approver は管理者のみ変更できます。';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- link_office_staff_auth_user: 対象UPDATEの直前だけトランザクションローカルで
-- バイパスフラグを立てる。呼び出し元（Edge Function）が既に管理者チェック済みであることが前提。
CREATE OR REPLACE FUNCTION public.link_office_staff_auth_user(
  p_staff_id bigint,
  p_auth_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.bypass_staff_protect_trigger', 'on', true);

  UPDATE office_staff
  SET auth_user_id = p_auth_user_id
  WHERE id = p_staff_id
    AND auth_user_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の担当者が見つからないか、既に招待済みです。';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.link_office_staff_auth_user(bigint, uuid) IS
  'invite-staff Edge Function 専用。招待成功時に auth_user_id を紐付ける。管理者チェックはEdge Function側で実施済み。トランザクションローカルフラグでトリガーの管理者チェックのみ一時的にスキップする。';

REVOKE EXECUTE ON FUNCTION public.link_office_staff_auth_user(bigint, uuid) FROM anon, authenticated, PUBLIC;
