-- 見積の申請時に作成者が指名する承認者を記録するカラム
-- 承認/差し戻し操作は、ログイン中の担当者がこのapprover_staff_idと一致する場合のみ許可する
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS approver_staff_id INTEGER REFERENCES office_staff(id) ON DELETE SET NULL;
