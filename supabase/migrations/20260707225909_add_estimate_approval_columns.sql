-- 見積の承認フロー証跡（承認者・承認日時・差し戻し理由）を記録するカラムを追加
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_reason TEXT;
