-- =========================================================
-- 担当者（office_staff）の権限まわりと在庫画像の書き込み権限を締める
--
-- 【問題】
-- 1. 業務管理者（admin）が、システム管理者（system_admin）の付与・剥奪や、
--    システム管理者の行の auth_user_id の付け替え（＝システム管理者に成り代わる）・削除ができた。
--    保護トリガーは「管理者かどうか」しか見ておらず、INSERT / DELETE は見ていなかった。
-- 2. office_staff を、作業員・閲覧者を含むログイン済みの全員が全行読めた
--    （氏名・ロール・承認者フラグ・auth_user_id）。作業員・閲覧者の画面が読むのは自分の行だけ。
-- 3. 在庫画像（inventory-images）は、ログインしていれば閲覧者でも書き込み・削除できた。
--    在庫テーブル（InventoryItems / Warehouses）を書けるのは admin / office / worker だけなので揃える。
--
-- 【対処】
-- 1. 保護トリガーを INSERT / UPDATE / DELETE に掛け、system_admin が関わる変更は
--    system_admin 本人だけに許す。既存の「管理者以外は role / auth_user_id / is_approver を変えられない」は維持。
--    招待の紐付け（link_office_staff_auth_user）が使う app.bypass_staff_protect_trigger は従来どおり全判定を飛ばす。
-- 2. office_staff の SELECT を「自分の行」と「管理者・事務」に限る。
--    is_admin() / current_staff_role() などは SECURITY DEFINER のため、この制限の影響を受けない。
-- 3. inventory-images の INSERT / UPDATE / DELETE を admin / office / worker に限る（閲覧は公開バケットのまま）。
-- =========================================================

-- ---------- 1. 保護トリガー ----------
CREATE OR REPLACE FUNCTION public.protect_office_staff_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.bypass_staff_protect_trigger', true), 'off') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'system_admin' AND NOT is_system_admin() THEN
      RAISE EXCEPTION 'システム管理者はシステム管理者だけが追加できます。';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'system_admin' AND NOT is_system_admin() THEN
      RAISE EXCEPTION 'システム管理者はシステム管理者だけが削除できます。';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.is_approver IS DISTINCT FROM OLD.is_approver THEN
    IF NOT is_admin() THEN
      RAISE EXCEPTION 'role, auth_user_id, is_approver は管理者のみ変更できます。';
    END IF;
    -- システム管理者への昇格・システム管理者からの降格・システム管理者の行の付け替えは、システム管理者だけ
    IF (OLD.role = 'system_admin' OR NEW.role = 'system_admin') AND NOT is_system_admin() THEN
      RAISE EXCEPTION 'システム管理者の権限・紐付けはシステム管理者だけが変更できます。';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_office_staff_privileged_columns ON public.office_staff;
CREATE TRIGGER trg_protect_office_staff_privileged_columns
  BEFORE INSERT OR UPDATE OR DELETE ON public.office_staff
  FOR EACH ROW EXECUTE FUNCTION public.protect_office_staff_privileged_columns();

-- ---------- 2. office_staff の閲覧範囲 ----------
DROP POLICY IF EXISTS "office_staff_select" ON public.office_staff;
CREATE POLICY "office_staff_select" ON public.office_staff
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.is_admin()
    OR public.current_staff_role() = 'office'
  );

-- ---------- 3. 在庫画像の書き込み権限 ----------
DROP POLICY IF EXISTS "inventory images insert authenticated" ON storage.objects;
DROP POLICY IF EXISTS "inventory images update authenticated" ON storage.objects;
DROP POLICY IF EXISTS "inventory images delete authenticated" ON storage.objects;

CREATE POLICY "inventory images insert staff" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inventory-images'
    AND (public.is_admin() OR public.current_staff_role() IN ('office', 'worker'))
  );

CREATE POLICY "inventory images update staff" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'inventory-images'
    AND (public.is_admin() OR public.current_staff_role() IN ('office', 'worker'))
  )
  WITH CHECK (
    bucket_id = 'inventory-images'
    AND (public.is_admin() OR public.current_staff_role() IN ('office', 'worker'))
  );

CREATE POLICY "inventory images delete staff" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'inventory-images'
    AND (public.is_admin() OR public.current_staff_role() IN ('office', 'worker'))
  );
