-- 見積承認者として指名可能な担当者を明示的に区別するフラグ
-- 既存の役職・権限メモ（role列）はフリーテキストのため強制力がなく、
-- 承認者指名モーダルの選択肢をこのフラグで絞り込む。
ALTER TABLE office_staff
  ADD COLUMN IF NOT EXISTS is_approver BOOLEAN NOT NULL DEFAULT false;
