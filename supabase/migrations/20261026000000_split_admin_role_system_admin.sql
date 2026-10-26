-- 管理者ロールを「業務管理者」(admin) と「システム管理者」(system_admin) に分割する。
-- system_admin は担当者名 "admin" のシステムアカウント専用で、権限は admin と同じ。
-- 違いは画面上の一覧・選択肢に表示されないことのみ（フロント側で制御）。

ALTER TABLE office_staff DROP CONSTRAINT IF EXISTS office_staff_role_check;
ALTER TABLE office_staff ADD CONSTRAINT office_staff_role_check
  CHECK (role IN ('admin', 'system_admin', 'office', 'worker', 'viewer'));

-- protect_office_staff_privileged_columns トリガーは非管理者の role 変更を拒否するため、
-- このトランザクション内に限りバイパスする（set_config の第3引数 true = LOCAL）。
SELECT set_config('app.bypass_staff_protect_trigger', 'on', true);
UPDATE office_staff SET role = 'system_admin'
WHERE id = 17 AND name = 'admin' AND role = 'admin';

-- RLS・トリガーの管理者判定はすべて is_admin() 経由のため、ここで両ロールを許可する。
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid() AND role IN ('admin', 'system_admin')
  );
$$;
