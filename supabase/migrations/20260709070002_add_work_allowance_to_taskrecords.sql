-- Add work_allowance column to TaskRecords table
-- 作業手当の対象作業かどうかを示すフラグ。帳票の「作業手当」欄に作業内容と実働時間を出力する判定に使用する。
ALTER TABLE "TaskRecords" ADD COLUMN IF NOT EXISTS work_allowance BOOLEAN DEFAULT false;
