-- 作業員・日付単位の休憩時間調整を保存する。
CREATE TABLE IF NOT EXISTS public."WorkerDailyBreakSettings" (
  worker_name text NOT NULL,
  date date NOT NULL,
  break_durations jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worker_name, date),
  CONSTRAINT worker_daily_break_settings_array CHECK (jsonb_typeof(break_durations) = 'array')
);

ALTER TABLE public."WorkerDailyBreakSettings" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."WorkerDailyBreakSettings" TO authenticated;

CREATE POLICY "worker_daily_break_settings_staff_all"
  ON public."WorkerDailyBreakSettings"
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.current_staff_role() IN ('office', 'worker'))
  WITH CHECK (public.is_admin() OR public.current_staff_role() IN ('office', 'worker'));

COMMENT ON TABLE public."WorkerDailyBreakSettings"
  IS '作業員・日付単位の日報用休憩時間設定（標準休憩の短縮・取得なし）';
