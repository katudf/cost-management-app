-- 見積金額を保存するためのカラムを追加するSQL
-- SupabaseのSQLエディタでこのクエリを実行してください。

ALTER TABLE public."ProjectTasks" 
ADD COLUMN estimated_amount numeric NOT NULL DEFAULT 0;