-- 就労日報用（早出・残業等の時間外労働）のカラムを追加するSQL
-- SupabaseのSQLエディタでこのクエリを実行してください。

ALTER TABLE public."TaskRecords" 
ADD COLUMN overtime_hours numeric NOT NULL DEFAULT 0;
