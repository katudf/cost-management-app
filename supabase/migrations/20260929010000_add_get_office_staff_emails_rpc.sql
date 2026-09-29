-- 担当者・関係者管理画面で、招待済み担当者のログイン用メールアドレスを表示するためのRPC。
-- office_staff にはメールアドレス列が無く、auth.users 側にしか無いため、
-- SECURITY DEFINER 関数で auth_user_id 経由で引いて返す。
-- メールアドレスは個人情報なので、管理者(admin)以外が呼んだ場合は0件を返す。

CREATE OR REPLACE FUNCTION public.get_office_staff_emails()
RETURNS TABLE (staff_id bigint, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id, u.email::text
  FROM office_staff s
  JOIN auth.users u ON u.id = s.auth_user_id
  WHERE is_admin();
$function$;

COMMENT ON FUNCTION public.get_office_staff_emails() IS
  '招待済み担当者のログイン用メールアドレス一覧（管理者のみ。管理者以外は0件）';

REVOKE EXECUTE ON FUNCTION public.get_office_staff_emails() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_office_staff_emails() TO authenticated;
