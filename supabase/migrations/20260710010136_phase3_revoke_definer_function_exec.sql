-- SECURITY DEFINER 関数の EXECUTE 権限を必要最小限に絞る（アドバイザWARN対応）
--
-- ロール判定ヘルパー: RLSポリシー評価は authenticated として実行されるため
-- authenticated の EXECUTE は残す。匿名（anon）とデフォルトの PUBLIC からは剥奪する
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_staff_role() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_approver_staff() FROM anon, PUBLIC;

-- トリガー関数: トリガー発火時は呼び出し側の EXECUTE 権限を要求しないため、
-- REST RPC 経由で誰からも直接呼べないよう全ロールから剥奪する
REVOKE EXECUTE ON FUNCTION public.protect_estimate_approval_columns() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_office_staff_privileged_columns() FROM anon, authenticated, PUBLIC;

-- 承認RPC: フロントエンドからログインユーザーが呼ぶため authenticated は残す。
-- 権限チェックは関数内部の is_approver_staff() で行われる
REVOKE EXECUTE ON FUNCTION public.approve_estimate(bigint) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_estimate(bigint, text) FROM anon, PUBLIC;
