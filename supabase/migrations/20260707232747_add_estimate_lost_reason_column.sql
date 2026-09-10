-- 見積の失注理由を記録するカラムを追加
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;
