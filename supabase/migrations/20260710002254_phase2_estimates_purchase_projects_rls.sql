-- Projects: admin/office フルアクセス、worker/viewer は SELECT のみ
DROP POLICY "projects_authenticated_all" ON "Projects";

CREATE POLICY "projects_office_all" ON "Projects"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

CREATE POLICY "projects_select_worker_viewer" ON "Projects"
  FOR SELECT TO authenticated
  USING (current_staff_role() IN ('worker', 'viewer'));

-- PurchaseRecords: admin/office のみ（worker/viewerはアクセス不可）
DROP POLICY "purchase_records_authenticated_all" ON "PurchaseRecords";

CREATE POLICY "purchase_records_office_all" ON "PurchaseRecords"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

-- estimates: admin フルアクセス、approver/office フルアクセス（承認操作の本人制限はアプリ層＋§4.1）
DROP POLICY "estimates_all" ON "estimates";

CREATE POLICY "estimates_office_all" ON "estimates"
  FOR ALL TO authenticated
  USING ((is_admin() OR current_staff_role() = 'office') AND deleted_at IS NULL)
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

-- estimate_items: estimates と同様の権限
DROP POLICY "estimate_items_all" ON "estimate_items";

CREATE POLICY "estimate_items_office_all" ON "estimate_items"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
