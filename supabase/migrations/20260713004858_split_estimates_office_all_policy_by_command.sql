-- estimates_office_all を コマンド別ポリシーへ分割する
DROP POLICY IF EXISTS estimates_office_all ON estimates;

CREATE POLICY estimates_office_select ON estimates
  FOR SELECT TO authenticated
  USING ((is_admin() OR current_staff_role() = 'office') AND deleted_at IS NULL);

CREATE POLICY estimates_office_insert ON estimates
  FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

CREATE POLICY estimates_office_update ON estimates
  FOR UPDATE TO authenticated
  USING ((is_admin() OR current_staff_role() = 'office') AND deleted_at IS NULL)
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

CREATE POLICY estimates_office_delete ON estimates
  FOR DELETE TO authenticated
  USING ((is_admin() OR current_staff_role() = 'office') AND deleted_at IS NULL);
