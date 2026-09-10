-- Phase 2: office_staff.role を admin/office/worker/viewer に正規化しCHECK制約を追加
-- 対象: id=17（システム管理者→admin）、id=3,4,5,7,8,16（自由記述/NULL→office）
-- id=18(worker)/19(viewer)は既に正規化済みの値のため変更不要

UPDATE office_staff SET role = 'admin' WHERE id = 17;
UPDATE office_staff SET role = 'office' WHERE id IN (3, 4, 5, 7, 8, 16);

ALTER TABLE office_staff ALTER COLUMN role SET DEFAULT 'office';
ALTER TABLE office_staff ADD CONSTRAINT office_staff_role_check
  CHECK (role IN ('admin', 'office', 'worker', 'viewer'));
