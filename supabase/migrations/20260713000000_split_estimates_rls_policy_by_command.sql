-- 見積書の論理削除（deleted_atをNULLから日時に更新）がRLS違反で失敗する不具合の修正。
-- 原因: 単一のFOR ALLポリシー（SELECT/INSERT/UPDATE/DELETE共通）だと、
-- UPDATE時にPostgreSQLがSELECTポリシーのUSING句を更新後の行に対しても再評価するため、
-- USING句に deleted_at IS NULL があると論理削除そのものが常に拒否される。
-- コマンドごとにポリシーを分割し、SELECTポリシーのUSING句からは deleted_at IS NULL を除外する。
-- 削除済み行の除外は既にアプリ側（supabaseEstimates.js の .is('deleted_at', null)）で行っているため、
-- RLS層で重ねて絞り込む必要はない。
DROP POLICY IF EXISTS estimates_office_all ON estimates;
DROP POLICY IF EXISTS estimates_office_select ON estimates;
DROP POLICY IF EXISTS estimates_office_insert ON estimates;
DROP POLICY IF EXISTS estimates_office_update ON estimates;
DROP POLICY IF EXISTS estimates_office_delete ON estimates;

CREATE POLICY estimates_office_select ON estimates
  FOR SELECT
  TO authenticated
  USING (
    is_admin() OR current_staff_role() = 'office'
  );

CREATE POLICY estimates_office_insert ON estimates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_admin() OR current_staff_role() = 'office'
  );

CREATE POLICY estimates_office_update ON estimates
  FOR UPDATE
  TO authenticated
  USING (
    (is_admin() OR current_staff_role() = 'office')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    is_admin() OR current_staff_role() = 'office'
  );

CREATE POLICY estimates_office_delete ON estimates
  FOR DELETE
  TO authenticated
  USING (
    (is_admin() OR current_staff_role() = 'office')
    AND deleted_at IS NULL
  );
