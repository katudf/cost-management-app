-- estimates.status のCHECK制約に submitted/ordered/lost を追加
-- （受注ステータス管理機能で使用するが、制約が未更新だったため PATCH が失敗していた）
ALTER TABLE estimates
  DROP CONSTRAINT IF EXISTS estimates_status_check;

ALTER TABLE estimates
  ADD CONSTRAINT estimates_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'returned'::text, 'submitted'::text, 'ordered'::text, 'lost'::text]));
