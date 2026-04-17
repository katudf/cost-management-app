-- TaskRecords テーブルに開始・終了時刻カラムを追加
-- Supabase SQL Editor で実行してください

ALTER TABLE public."TaskRecords"
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;

-- 確認クエリ
-- SELECT id, date, worker_name, hours, overtime_hours, start_time, end_time FROM "TaskRecords" LIMIT 5;
