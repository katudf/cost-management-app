DROP POLICY "office_staff_write" ON "office_staff";

CREATE POLICY "office_staff_insert_admin" ON "office_staff"
  FOR INSERT TO authenticated WITH CHECK (is_admin());

CREATE POLICY "office_staff_delete_admin" ON "office_staff"
  FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "office_staff_update_admin_or_self" ON "office_staff"
  FOR UPDATE TO authenticated
  USING (is_admin() OR auth_user_id = auth.uid())
  WITH CHECK (is_admin() OR auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.protect_office_staff_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.is_approver IS DISTINCT FROM OLD.is_approver THEN
      RAISE EXCEPTION 'role, auth_user_id, is_approver は管理者のみ変更できます。';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_office_staff_privileged_columns ON office_staff;
CREATE TRIGGER trg_protect_office_staff_privileged_columns
  BEFORE UPDATE ON office_staff
  FOR EACH ROW
  EXECUTE FUNCTION protect_office_staff_privileged_columns();
