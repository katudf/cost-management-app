-- SELECT から deleted_at IS NULL を外す
-- （ソフト削除された見積を「削除済み」一覧に表示し、復元できるようにするため）
DROP POLICY IF EXISTS estimates_office_select ON estimates;

CREATE POLICY estimates_office_select ON estimates
  FOR SELECT TO authenticated
  USING (is_admin() OR current_staff_role() = 'office');
