-- ProjectTasks: admin/office フルアクセス、worker はSELECTのみ、viewerは不可
DROP POLICY "project_tasks_authenticated_all" ON "ProjectTasks";
CREATE POLICY "project_tasks_office_all" ON "ProjectTasks"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY "project_tasks_select_worker" ON "ProjectTasks"
  FOR SELECT TO authenticated
  USING (current_staff_role() = 'worker');

-- TaskRecords（日報）: admin/office/worker フルアクセス（共有アカウント）、viewerは不可
DROP POLICY "task_records_authenticated_all" ON "TaskRecords";
CREATE POLICY "task_records_staff_all" ON "TaskRecords"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() IN ('office', 'worker'))
  WITH CHECK (is_admin() OR current_staff_role() IN ('office', 'worker'));

-- SubcontractorRecords: admin/office のみ
DROP POLICY "subcontractor_records_authenticated_all" ON "SubcontractorRecords";
CREATE POLICY "subcontractor_records_office_all" ON "SubcontractorRecords"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

-- Assignments（配置表）: admin/office フルアクセス、worker/viewerはSELECTのみ
DROP POLICY "assignments_authenticated_all" ON "Assignments";
CREATE POLICY "assignments_office_all" ON "Assignments"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY "assignments_select_worker_viewer" ON "Assignments"
  FOR SELECT TO authenticated
  USING (current_staff_role() IN ('worker', 'viewer'));

-- CertificationNames: admin/office フルアクセス、workerはSELECTのみ
DROP POLICY "certificationnames_authenticated_all" ON "CertificationNames";
CREATE POLICY "certificationnames_office_all" ON "CertificationNames"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY "certificationnames_select_worker" ON "CertificationNames"
  FOR SELECT TO authenticated
  USING (current_staff_role() = 'worker');

-- system_settings: adminのみ書き込み可、office/worker/viewerはSELECTのみ
DROP POLICY "system_settings_authenticated_all" ON "system_settings";
CREATE POLICY "system_settings_admin_all" ON "system_settings"
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "system_settings_select_staff" ON "system_settings"
  FOR SELECT TO authenticated
  USING (current_staff_role() IN ('office', 'worker', 'viewer'));

-- OvertimeApprovals: admin/office フルアクセス、workerはSELECTのみ
DROP POLICY "overtime_approvals_authenticated_all" ON "OvertimeApprovals";
CREATE POLICY "overtime_approvals_office_all" ON "OvertimeApprovals"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY "overtime_approvals_select_worker" ON "OvertimeApprovals"
  FOR SELECT TO authenticated
  USING (current_staff_role() = 'worker');

-- WorkAllowanceApprovals: admin/office フルアクセス、workerはSELECTのみ
DROP POLICY "work_allowance_approvals_authenticated_all" ON "WorkAllowanceApprovals";
CREATE POLICY "work_allowance_approvals_office_all" ON "WorkAllowanceApprovals"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY "work_allowance_approvals_select_worker" ON "WorkAllowanceApprovals"
  FOR SELECT TO authenticated
  USING (current_staff_role() = 'worker');

-- Warehouses: admin/office/worker フルアクセス（在庫は現場でも動かすため）
DROP POLICY "warehouses_authenticated_all" ON "Warehouses";
CREATE POLICY "warehouses_staff_all" ON "Warehouses"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() IN ('office', 'worker'))
  WITH CHECK (is_admin() OR current_staff_role() IN ('office', 'worker'));

-- InventoryItems: admin/office/worker フルアクセス
DROP POLICY "inventory_items_authenticated_all" ON "InventoryItems";
CREATE POLICY "inventory_items_staff_all" ON "InventoryItems"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() IN ('office', 'worker'))
  WITH CHECK (is_admin() OR current_staff_role() IN ('office', 'worker'));

-- CompanyHolidays: admin/office フルアクセス、worker/viewerはSELECTのみ
DROP POLICY "company_holidays_authenticated_all" ON "CompanyHolidays";
CREATE POLICY "company_holidays_office_all" ON "CompanyHolidays"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY "company_holidays_select_worker_viewer" ON "CompanyHolidays"
  FOR SELECT TO authenticated
  USING (current_staff_role() IN ('worker', 'viewer'));

-- ProjectSuspensions: admin/office フルアクセス、worker/viewerはSELECTのみ
DROP POLICY "project_suspensions_authenticated_all" ON "ProjectSuspensions";
CREATE POLICY "project_suspensions_office_all" ON "ProjectSuspensions"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY "project_suspensions_select_worker_viewer" ON "ProjectSuspensions"
  FOR SELECT TO authenticated
  USING (current_staff_role() IN ('worker', 'viewer'));
