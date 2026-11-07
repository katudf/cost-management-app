-- Isolated PostgreSQL fixture for scripts/test-login-id-db.py. No production data or credentials.
-- office_staff の RLS・ロール判定関数は 2026-11-05 の権限強化（20261105060000）時点の定義に合わせ、
-- auth.users は login-id のマイグレーションが参照する列だけに絞る。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  encrypted_password text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.office_staff (
  id bigint PRIMARY KEY,
  name text,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  role text CHECK (role IN ('admin', 'system_admin', 'office', 'worker', 'viewer')),
  is_approver boolean DEFAULT false
);

CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM office_staff WHERE auth_user_id = auth.uid() AND role IN ('admin', 'system_admin'));
$$;
CREATE FUNCTION public.current_staff_role() RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT role FROM office_staff WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

ALTER TABLE public.office_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY office_staff_select ON public.office_staff FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_admin() OR public.current_staff_role() = 'office');
CREATE POLICY office_staff_insert_admin ON public.office_staff FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY office_staff_delete_admin ON public.office_staff FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY office_staff_update_admin_or_self ON public.office_staff FOR UPDATE TO authenticated
  USING (is_admin() OR auth_user_id = auth.uid())
  WITH CHECK (is_admin() OR auth_user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_staff TO authenticated;

-- 利用者（UUID の末尾が担当者IDと同じ）
INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('00000000-0000-0000-0000-000000000001', 'sysadmin@login.invalid', 'hash-1'),
  ('00000000-0000-0000-0000-000000000002', 'admin-a@example.com', 'hash-2'),
  ('00000000-0000-0000-0000-000000000003', 'admin-b@login.invalid', 'hash-3'),
  ('00000000-0000-0000-0000-000000000004', 'office@login.invalid', 'hash-4'),
  ('00000000-0000-0000-0000-000000000005', 'genba@login.invalid', 'hash-5'),
  ('00000000-0000-0000-0000-000000000007', 'newcomer@login.invalid', 'hash-7');

INSERT INTO public.office_staff (id, name, auth_user_id, role) VALUES
  (1, 'システム', '00000000-0000-0000-0000-000000000001', 'system_admin'),
  (2, '管理者A', '00000000-0000-0000-0000-000000000002', 'admin'),
  (3, '管理者B', '00000000-0000-0000-0000-000000000003', 'admin'),
  (4, '事務', '00000000-0000-0000-0000-000000000004', 'office'),
  (5, '現場共通', '00000000-0000-0000-0000-000000000005', 'worker'),
  (6, '未発行の事務', NULL, 'office'),
  (7, '新人', NULL, 'office'),
  (8, '削除用', NULL, 'viewer');
