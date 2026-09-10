-- ============================================
-- Phase 0: 非破壊的セキュリティ強化
-- docs/security-permissions-spec.md §7 Phase 0
-- ============================================

-- 1. レガシー5テーブルを RLS有効化・ポリシー無しで全遮断（DROPはしない・未決事項のため）
ALTER TABLE "DailyReports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkLogs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaterialUsageLogs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceMaster" ENABLE ROW LEVEL SECURITY;

-- 2. 残り8テーブル: RLS有効化 + オープンポリシー（現行動作を維持しつつERROR警告を解消）
ALTER TABLE "Workers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workers_open" ON "Workers" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "WorkerCertifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "worker_certifications_open" ON "WorkerCertifications" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "Customers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_open" ON "Customers" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "Projects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_open" ON "Projects" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "TaskRecords" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_records_open" ON "TaskRecords" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "Assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assignments_open" ON "Assignments" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "ProjectTasks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_tasks_open" ON "ProjectTasks" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "CompanyHolidays" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_holidays_open" ON "CompanyHolidays" FOR ALL USING (true) WITH CHECK (true);

-- 3. office_staff 特別対応: SELECTはオープン、書き込みは認証済みユーザーのみに制限
ALTER TABLE office_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "office_staff_select" ON office_staff
  FOR SELECT USING (true);
CREATE POLICY "office_staff_write" ON office_staff
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. v_estimate_category_totals ビューを SECURITY DEFINER から SECURITY INVOKER に変更
ALTER VIEW v_estimate_category_totals SET (security_invoker = true);

-- 5. 関数の search_path 固定（mutable search_path 警告の解消）
ALTER FUNCTION calc_estimate_item_amount() SET search_path = public;
ALTER FUNCTION set_updated_at() SET search_path = public;
ALTER FUNCTION get_next_estimate_seq(text) SET search_path = public;
ALTER FUNCTION overwrite_paste(jsonb) SET search_path = public;
ALTER FUNCTION save_estimate_items(bigint, jsonb) SET search_path = public;
