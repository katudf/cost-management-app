-- Phase 1: 全テーブルの開放RLSポリシーを TO authenticated に変換

-- ===== 単純 "ALL" 開放ポリシー (11テーブル) =====

DROP POLICY "assignments_open" ON "Assignments";
CREATE POLICY "assignments_authenticated_all" ON "Assignments"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "Allow all access to CertificationNames" ON "CertificationNames";
CREATE POLICY "certificationnames_authenticated_all" ON "CertificationNames"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "company_holidays_open" ON "CompanyHolidays";
CREATE POLICY "company_holidays_authenticated_all" ON "CompanyHolidays"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "customers_open" ON "Customers";
CREATE POLICY "customers_authenticated_all" ON "Customers"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "Allow all" ON "ProjectSuspensions";
CREATE POLICY "project_suspensions_authenticated_all" ON "ProjectSuspensions"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "project_tasks_open" ON "ProjectTasks";
CREATE POLICY "project_tasks_authenticated_all" ON "ProjectTasks"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "projects_open" ON "Projects";
CREATE POLICY "projects_authenticated_all" ON "Projects"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "Enable all access" ON "SubcontractorRecords";
CREATE POLICY "subcontractor_records_authenticated_all" ON "SubcontractorRecords"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "task_records_open" ON "TaskRecords";
CREATE POLICY "task_records_authenticated_all" ON "TaskRecords"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "worker_certifications_open" ON "WorkerCertifications";
CREATE POLICY "worker_certifications_authenticated_all" ON "WorkerCertifications"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "workers_open" ON "Workers";
CREATE POLICY "workers_authenticated_all" ON "Workers"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== 4分割ポリシー (SELECT/INSERT/UPDATE/DELETE 個別, 6テーブル) =====

DROP POLICY "Enable read access for all users" ON "InventoryItems";
DROP POLICY "Enable insert for all users" ON "InventoryItems";
DROP POLICY "Enable update for all users" ON "InventoryItems";
DROP POLICY "Enable delete for all users" ON "InventoryItems";
CREATE POLICY "inventory_items_authenticated_all" ON "InventoryItems"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "Enable read access for all users" ON "OvertimeApprovals";
DROP POLICY "Enable insert for all users" ON "OvertimeApprovals";
DROP POLICY "Enable update for all users" ON "OvertimeApprovals";
DROP POLICY "Enable delete for all users" ON "OvertimeApprovals";
CREATE POLICY "overtime_approvals_authenticated_all" ON "OvertimeApprovals"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "Enable read access for all users" ON "PurchaseRecords";
DROP POLICY "Enable insert for all users" ON "PurchaseRecords";
DROP POLICY "Enable update for all users" ON "PurchaseRecords";
DROP POLICY "Enable delete for all users" ON "PurchaseRecords";
CREATE POLICY "purchase_records_authenticated_all" ON "PurchaseRecords"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "Enable read access for all users" ON "Warehouses";
DROP POLICY "Enable insert for all users" ON "Warehouses";
DROP POLICY "Enable update for all users" ON "Warehouses";
DROP POLICY "Enable delete for all users" ON "Warehouses";
CREATE POLICY "warehouses_authenticated_all" ON "Warehouses"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY "Enable read access for all users" ON "WorkAllowanceApprovals";
DROP POLICY "Enable insert for all users" ON "WorkAllowanceApprovals";
DROP POLICY "Enable update for all users" ON "WorkAllowanceApprovals";
DROP POLICY "Enable delete for all users" ON "WorkAllowanceApprovals";
CREATE POLICY "work_allowance_approvals_authenticated_all" ON "WorkAllowanceApprovals"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- system_settings: INSERT/SELECT/UPDATEのみ(DELETEポリシーなし)
DROP POLICY "Enable read access for all users" ON "system_settings";
DROP POLICY "Enable insert for all users" ON "system_settings";
DROP POLICY "Enable update for all users" ON "system_settings";
CREATE POLICY "system_settings_authenticated_all" ON "system_settings"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== 特殊ケース: estimates / estimate_items =====

DROP POLICY "Allow all on estimates" ON "estimates";
DROP POLICY "estimates_all" ON "estimates";
CREATE POLICY "estimates_all" ON "estimates"
  FOR ALL TO authenticated USING (deleted_at IS NULL) WITH CHECK (true);

DROP POLICY "Allow all on estimate_items" ON "estimate_items";
DROP POLICY "estimate_items_all" ON "estimate_items";
CREATE POLICY "estimate_items_all" ON "estimate_items"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== office_staff =====

DROP POLICY "office_staff_select" ON "office_staff";
CREATE POLICY "office_staff_select" ON "office_staff"
  FOR SELECT TO authenticated USING (true);

-- ===== Storage: inventory-images バケットの書き込みポリシーを authenticated 限定に =====

DROP POLICY "inventory images insert" ON storage.objects;
DROP POLICY "inventory images update" ON storage.objects;
DROP POLICY "inventory images delete" ON storage.objects;

CREATE POLICY "inventory images insert authenticated" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inventory-images');

CREATE POLICY "inventory images update authenticated" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'inventory-images');

CREATE POLICY "inventory images delete authenticated" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'inventory-images');
