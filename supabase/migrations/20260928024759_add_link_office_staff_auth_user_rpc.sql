-- invite-staff Edge Function は service_role キーで office_staff.auth_user_id を
-- 直接 UPDATE していたが、trg_protect_office_staff_privileged_columns トリガー内の
-- is_admin() が auth.uid() に依存しており、service_role 実行時は auth.uid() が
-- NULL になって false を返すため、トリガーが誤って
-- 「role, auth_user_id, is_approver は管理者のみ変更できます。」を投げ 500 エラーになっていた。
--
-- Edge Function 側は呼び出し元が管理者であることを既にコード内で検証済みのため、
-- トリガー自体は変更せず、招待完了時の auth_user_id 紐付けだけを行う
-- SECURITY DEFINER の専用RPC関数を新設する。この関数は SET search_path で固定し、
-- office_staff テーブルへの一般的な更新経路としては使わせない（EXECUTE権限を絞る）。

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
  'invite-staff Edge Function 専用。招待成功時に auth_user_id を紐付ける。管理者チェックはEdge Function側で実施済み。';

-- REST RPC 経由で誰からも直接呼べないよう anon/authenticated/PUBLIC から剥奪する
-- （Edge Function は service_role キーで呼ぶため、service_role の実行権限は残る）
REVOKE EXECUTE ON FUNCTION public.link_office_staff_auth_user(bigint, uuid) FROM anon, authenticated, PUBLIC;
