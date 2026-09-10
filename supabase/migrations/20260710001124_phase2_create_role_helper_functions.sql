-- Phase 2: ロール判定用ヘルパー関数
-- SECURITY DEFINER + search_path固定 + STABLE で安全に実行

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT role FROM office_staff WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_approver_staff()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid() AND is_approver = true
  );
$$;
