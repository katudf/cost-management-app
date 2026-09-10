-- workers_directory ビュー（在庫管理の作業員選択用）は Workers テーブルの RLS を継承するため、
-- is_staff() だけでなく Workers 自体のポリシーも通過する必要がある。
-- workers_office_all は role='office' のみを許可しており worker ロールが弾かれ、
-- 在庫管理アプリのログイン後に作業員一覧が0件になる不具合の原因だった。
-- InventoryItems / Warehouses と同じく office・worker 双方を許可するよう修正する。
drop policy if exists "workers_office_all" on "Workers";

create policy "workers_office_all" on "Workers"
  for all
  to authenticated
  using (is_admin() or current_staff_role() = any (array['office', 'worker']));
