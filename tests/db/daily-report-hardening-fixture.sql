-- Isolated PostgreSQL fixture for scripts/test-daily-report-hardening-db.py. No production data or credentials.
-- tests/db/worker-login-fixture.sql と 20261107020000 / 20261110000000 を流したあとに読み込み、
-- M2（20261120010000_daily_report_rpc_v2.sql）が参照するものを足す。
-- WorkerDailyBreakSettings は本物のマイグレーション（20260930000000）をスクリプト側で流す。

-- Projects: 現場の名簿ビュー（projects_directory）が出す列と、出さない金額の列
ALTER TABLE public."Projects"
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN short_name text,
  ADD COLUMN status text,
  ADD COLUMN "startDate" date,
  ADD COLUMN "endDate" date,
  ADD COLUMN bar_color text,
  ADD COLUMN display_order integer,
  ADD COLUMN "order" bigint NOT NULL DEFAULT 1,
  ADD COLUMN show_on_home boolean DEFAULT true,
  ADD COLUMN "estimatedAmount" bigint,
  ADD COLUMN "finalAmount" bigint;
UPDATE public."Projects" SET status = '施工中', "estimatedAmount" = 1000000, "finalAmount" = 1200000;
INSERT INTO public."Projects" (id, name, foreman_worker_id, status, "estimatedAmount") VALUES (3, '現場C', 2, '予定', 500000);

ALTER TABLE public."Projects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_office_all ON public."Projects" TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
CREATE POLICY projects_select_worker_viewer ON public."Projects" FOR SELECT TO authenticated
  USING (current_staff_role() IN ('worker', 'viewer'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Projects" TO authenticated;

-- 現場B・C の作業項目（ProjectTasks.id 1 は現場A）
INSERT INTO public."ProjectTasks" (id, "projectId", name, "order", progress_percentage) VALUES
  (2, 2, '下塗り', 1, 0),
  (3, 3, '上塗り', 1, 0);

-- 作業手当の申請（鈴木・現場A）
INSERT INTO public."WorkAllowanceApprovals" (id, project_id, worker_name, date, status, task_names, updated_at) VALUES
  (1, 1, '鈴木 次郎', '2026-11-01', 'pending', ARRAY['塗装', '足場'], now()),
  (2, 1, '鈴木 次郎', '2026-11-02', 'pending', ARRAY['塗装'], now());
SELECT setval(pg_get_serial_sequence('public."WorkAllowanceApprovals"', 'id'), 10);
UPDATE public."OvertimeApprovals" SET updated_at = now();
