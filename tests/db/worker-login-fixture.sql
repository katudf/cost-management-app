-- Isolated PostgreSQL fixture for scripts/test-worker-login-db.py. No production data or credentials.
-- tests/db/login-id-fixture.sql（担当者・auth.users）と login-id のマイグレーションを流したあとに読み込み、
-- 作業員・日報まわりで 20261107020000_worker_personal_login.sql が参照するものだけを用意する。
-- 日報の内部関数（_upsert_task_record など）は、判定のテストに必要な最小限の代用品にしている。

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz;

CREATE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM office_staff WHERE auth_user_id = auth.uid());
$$;
CREATE FUNCTION public.is_office_or_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.is_admin() OR public.current_staff_role() = 'office';
$$;

CREATE TABLE public."Workers" (
  id bigint PRIMARY KEY,
  name text,
  kana text,
  worker_type text NOT NULL DEFAULT '職人',
  display_order integer,
  resignation_date date,
  show_in_assignment boolean NOT NULL DEFAULT true,
  "birthDate" text
);
ALTER TABLE public."Workers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workers_office_all ON public."Workers" TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Workers" TO authenticated;

CREATE VIEW public.workers_directory AS
  SELECT id, name, display_order, worker_type, resignation_date, show_in_assignment
  FROM public."Workers" WHERE is_staff();
GRANT SELECT ON public.workers_directory TO authenticated;

CREATE TABLE public."Projects" (id bigint PRIMARY KEY, name text, foreman_worker_id bigint);
CREATE TABLE public."ProjectTasks" (
  id bigserial PRIMARY KEY, "projectId" bigint, name text, target_hours numeric, estimated_amount numeric,
  "order" bigint, progress_percentage bigint
);
CREATE TABLE public."TaskRecords" (
  id bigserial PRIMARY KEY, project_id bigint, project_task_id bigint, date date, worker_name text,
  hours float8, overtime_hours numeric, early_overtime_hours numeric, start_time time, end_time time,
  note text, work_allowance boolean
);
CREATE TABLE public."SubcontractorRecords" (
  id uuid PRIMARY KEY, project_id bigint, date date, company_name text, worker_count numeric,
  unit_price numeric, worker_name text
);
CREATE TABLE public."OvertimeApprovals" (
  id bigserial PRIMARY KEY, project_id bigint, worker_name text, date date, status text,
  requested_hours numeric, approved_hours numeric, approved_by text, approved_at timestamptz,
  acknowledged_at timestamptz, updated_at timestamptz
);
CREATE TABLE public."WorkAllowanceApprovals" (
  id bigserial PRIMARY KEY, project_id bigint, worker_name text, date date, status text,
  task_names text[], approved_task_names text[], approved_by text, approved_at timestamptz,
  acknowledged_at timestamptz, updated_at timestamptz
);

-- 職長判定（20261105010000 / 20261105020000 と同じ）
CREATE FUNCTION public.is_project_foreman(p_project_id bigint, p_worker_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_worker_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."Projects" WHERE id = p_project_id AND foreman_worker_id = p_worker_id);
$$;
CREATE FUNCTION public.is_declared_worker(p_worker_id bigint, p_worker_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_worker_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."Workers" WHERE id = p_worker_id AND btrim(name) = btrim(p_worker_name));
$$;
CREATE FUNCTION public.is_declared_foreman(p_project_id bigint, p_worker_id bigint, p_worker_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_declared_worker(p_worker_id, p_worker_name) AND public.is_project_foreman(p_project_id, p_worker_id);
$$;

-- 日報の内部関数の代用品
CREATE FUNCTION public._upsert_task_record(p_row jsonb, p_project_id bigint, p_date date, p_worker_name text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO "TaskRecords" (project_id, project_task_id, date, worker_name, hours)
  VALUES (p_project_id, (p_row->>'project_task_id')::bigint, p_date, p_worker_name, COALESCE((p_row->>'hours')::float8, 0))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
CREATE FUNCTION public._late_overtime_total(p_project_id bigint, p_worker_name text, p_date date)
RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public._sync_overtime_approval(p_project_id bigint, p_worker_name text, p_date date, p_total numeric, p_reason text)
RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public._sync_work_allowance_approval(p_project_id bigint, p_worker_name text, p_date date, p_task_names text[])
RETURNS void LANGUAGE sql AS $$ SELECT $$;

-- 作業員（UUID の末尾 1xx）
INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('00000000-0000-0000-0000-000000000101', 'tanaka@login.invalid', 'hash-101'),
  ('00000000-0000-0000-0000-000000000102', 'suzuki@login.invalid', 'hash-102'),
  ('00000000-0000-0000-0000-000000000103', 'retired@login.invalid', 'hash-103'),
  ('00000000-0000-0000-0000-000000000104', 'future@login.invalid', 'hash-104'),
  ('00000000-0000-0000-0000-000000000105', 'spare@login.invalid', 'hash-105');

INSERT INTO public."Workers" (id, name, kana, resignation_date) VALUES
  (1, '田中 太郎', 'タナカ タロウ', NULL),
  (2, '鈴木 次郎', 'スズキ ジロウ', NULL),
  (3, '退職 三郎', 'タイショク サブロウ', (now() AT TIME ZONE 'Asia/Tokyo')::date),
  (4, '予定 四郎', 'ヨテイ シロウ', (now() AT TIME ZONE 'Asia/Tokyo')::date + 30),
  (5, '未発行 五郎', NULL, NULL),
  (6, '事務兼 六子', NULL, NULL),
  (7, '削除用 七', NULL, NULL);

INSERT INTO public."Projects" (id, name, foreman_worker_id) VALUES (1, '現場A', 1), (2, '現場B', NULL);
INSERT INTO public."ProjectTasks" (id, "projectId", name, "order", progress_percentage) VALUES (1, 1, '塗装', 1, 0);
INSERT INTO public."OvertimeApprovals" (id, project_id, worker_name, date, status, requested_hours) VALUES
  (1, 1, '鈴木 次郎', '2026-11-01', 'pending', 1),
  (2, 1, '鈴木 次郎', '2026-11-02', 'pending', 1),
  (3, 1, '鈴木 次郎', '2026-11-03', 'pending', 1),
  (4, 1, '鈴木 次郎', '2026-11-04', 'approved', 1);
SELECT setval(pg_get_serial_sequence('public."ProjectTasks"', 'id'), 10);
SELECT setval(pg_get_serial_sequence('public."OvertimeApprovals"', 'id'), 10);
