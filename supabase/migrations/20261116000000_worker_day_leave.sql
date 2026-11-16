-- =========================================================
-- 日報画面から有給・振休を入力する（配置表 Assignments の「現場なし」行として記録）
--
-- 1. 半日の種別（有給(午前) / 有給(午後) / 振休(午前) / 振休(午後)）は title の値を増やすだけで、
--    DB の変更は要らない。
-- 2. 振休の振替元（休業日に出勤した日）を Assignments.substitute_for_date に記録する。
--    日報画面からの振休では必須、配置表（管理者画面）からは任意。
-- 3. worker ロールは Assignments に書き込めない（RLS は事務・管理者のみ）。
--    自分のその日の有給・振休の行だけを置き換える SECURITY DEFINER の RPC を用意する。
--    作業員の決め方は save_daily_report と同じ（個人アカウントは本人に固定、共有アカウントと担当者は申告どおり）。
-- 4. 振替元の候補を返す RPC。候補は「その作業員が休業日（日曜・会社カレンダーの休日）に日報を入れた日」。
--    1 つの振替元で使えるのは合計 1 日分（終日 1 回、または半日 2 回）まで。
-- =========================================================

-- ---------- 1. 振替元の列 ----------
ALTER TABLE public."Assignments" ADD COLUMN IF NOT EXISTS substitute_for_date date;

COMMENT ON COLUMN public."Assignments".substitute_for_date IS
  '振休の振替元（休業日に出勤した日）。振休・振休(午前)・振休(午後)の行だけで使う。日報画面からの振休では必須';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_substitute_for_date_check') THEN
    ALTER TABLE public."Assignments" ADD CONSTRAINT assignments_substitute_for_date_check
      CHECK (substitute_for_date IS NULL OR ("projectId" IS NULL AND title IN ('振休', '振休(午前)', '振休(午後)')));
  END IF;
END $$;

-- 振替元の使用量を数えるための索引
CREATE INDEX IF NOT EXISTS assignments_worker_substitute_idx
  ON public."Assignments" ("workerId", substitute_for_date)
  WHERE substitute_for_date IS NOT NULL;

-- ---------- 2. 共通ヘルパー ----------
-- 休みの種別の重み（終日 1、半日 0.5）。有給・振休以外は NULL
CREATE OR REPLACE FUNCTION public._leave_weight(p_title text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_title
    WHEN '有給' THEN 1.0 WHEN '振休' THEN 1.0
    WHEN '有給(午前)' THEN 0.5 WHEN '有給(午後)' THEN 0.5
    WHEN '振休(午前)' THEN 0.5 WHEN '振休(午後)' THEN 0.5
    ELSE NULL
  END;
$$;

-- 休みの時間帯（'full' / 'am' / 'pm'）。有給・振休以外は NULL
CREATE OR REPLACE FUNCTION public._leave_part(p_title text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_title IN ('有給', '振休') THEN 'full'
    WHEN p_title IN ('有給(午前)', '振休(午前)') THEN 'am'
    WHEN p_title IN ('有給(午後)', '振休(午後)') THEN 'pm'
    ELSE NULL
  END;
$$;

-- 休業日か（日曜、または会社カレンダーの休日。会議などの行事は休業日ではない）。
-- 画面側の isNonWorkingDay（src/utils/holidayUtils.js）と同じ判定。
CREATE OR REPLACE FUNCTION public._is_non_working_day(p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT extract(dow FROM p_date) = 0 OR EXISTS (
    SELECT 1 FROM "CompanyHolidays" ch
     WHERE ch.date = p_date
       AND (ch.description IS NULL OR btrim(ch.description) IN ('', '休日'))
  );
$$;

REVOKE EXECUTE ON FUNCTION public._is_non_working_day(date) FROM anon, PUBLIC, authenticated;

-- ---------- 3. 振替元の候補 ----------
-- 戻り値: 休業日に日報がある日と、その振替元の残り（1.0 / 0.5）。
-- p_date の休み（これから置き換える行）が使っている分は「使っていない」として数える。
-- 使い切った日は返さない。新しい順。
CREATE OR REPLACE FUNCTION public.get_substitute_holiday_candidates(
  p_worker_id bigint, p_worker_name text, p_date date
)
RETURNS TABLE (work_date date, remaining numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id bigint;
  v_worker text;
BEGIN
  IF NOT (public.is_office_or_admin() OR COALESCE(public.current_staff_role() = 'worker', false)) THEN
    RAISE EXCEPTION '振替元を確認する権限がありません。' USING ERRCODE = '42501';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_worker_id, p_worker_name) e;
  -- 日報は名前、休みの行は ID で引くため、ID と名前が同じ人かを確かめる
  IF v_worker_id IS NULL OR v_worker IS NULL OR p_date IS NULL
     OR NOT public.is_declared_worker(v_worker_id, v_worker) THEN
    RAISE EXCEPTION '作業員の指定が不正です。' USING ERRCODE = '22023';
  END IF;

  -- 候補は休みを取る日の前後 1 年の休業日（日曜・会社カレンダーの休日）に限る
  RETURN QUERY
  WITH work_days AS (
    SELECT DISTINCT tr.date AS d
      FROM "TaskRecords" tr
     WHERE tr.worker_name = v_worker
       AND tr.date BETWEEN p_date - 365 AND p_date + 365
       AND tr.date <> p_date
       AND (extract(dow FROM tr.date) = 0 OR EXISTS (
             SELECT 1 FROM "CompanyHolidays" ch
              WHERE ch.date = tr.date
                AND (ch.description IS NULL OR btrim(ch.description) IN ('', '休日'))
           ))
  ), used AS (
    SELECT a.substitute_for_date AS d, sum(public._leave_weight(a.title)) AS w
      FROM "Assignments" a
     WHERE a."workerId" = v_worker_id
       AND a.substitute_for_date IS NOT NULL
       AND a.date IS DISTINCT FROM p_date
     GROUP BY a.substitute_for_date
  )
  SELECT wd.d, (1.0 - COALESCE(u.w, 0))::numeric
    FROM work_days wd
    LEFT JOIN used u ON u.d = wd.d
   WHERE 1.0 - COALESCE(u.w, 0) > 0
   ORDER BY wd.d DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_substitute_holiday_candidates(bigint, text, date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_substitute_holiday_candidates(bigint, text, date) TO authenticated;

-- ---------- 4. その日の休みの保存 ----------
-- p_entries: [{ "title": '有給' など 6 種別のいずれか, "substitute_for_date": 'YYYY-MM-DD'（振休のみ必須） }]
--   空配列はその日の有給・振休を取り消す。
-- その作業員・その日の有給・振休の行（誰が入れたものでも）を、p_entries で置き換える。
-- 現場の行や、健診・会社など他の種別の行には触れない。
-- 戻り値: 保存後のその日の有給・振休の行 [{ id, title, substitute_for_date, assignment_order }]
CREATE OR REPLACE FUNCTION public.save_worker_day_leave(
  p_worker_id bigint, p_worker_name text, p_date date, p_entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id bigint;
  v_worker text;
  v_entries jsonb := COALESCE(p_entries, '[]'::jsonb);
  v_entry jsonb;
  v_title text;
  v_part text;
  v_sub date;
  v_parts text[] := ARRAY[]::text[];
  v_used numeric;
  v_new numeric;
  v_order bigint;
  v_result jsonb;
BEGIN
  IF NOT (public.is_office_or_admin() OR COALESCE(public.current_staff_role() = 'worker', false)) THEN
    RAISE EXCEPTION '休みを登録する権限がありません。' USING ERRCODE = '42501';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_worker_id, p_worker_name) e;
  IF v_worker_id IS NULL OR v_worker IS NULL OR p_date IS NULL OR jsonb_typeof(v_entries) <> 'array' THEN
    RAISE EXCEPTION '休みの登録内容が不正です。' USING ERRCODE = '22023';
  END IF;
  -- 振替元の日報は名前、休みの行と使用量は ID で引くため、ID と名前が同じ人かを確かめる
  IF NOT public.is_declared_worker(v_worker_id, v_worker) THEN
    RAISE EXCEPTION '作業員の ID と名前が一致しません。画面を読み込み直してください。' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Workers" w WHERE w.id = v_worker_id AND w.subcontractor_id IS NULL) THEN
    RAISE EXCEPTION '作業員が見つかりません。' USING ERRCODE = '22023';
  END IF;

  -- 同じ作業員の同時保存（2 台の端末など）で振替元の使用量の確認がすり抜けないようにする
  PERFORM pg_advisory_xact_lock(hashtextextended('save_worker_day_leave:' || v_worker_id::text, 0));

  -- 入力の確認: 種別・組み合わせ（終日 1 つ、または午前・午後それぞれ 0〜1 つ）
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_entries) LOOP
    v_title := v_entry->>'title';
    v_part := public._leave_part(v_title);
    IF v_part IS NULL THEN
      RAISE EXCEPTION '休みの種別が不正です（%）。', COALESCE(v_title, '空') USING ERRCODE = '22023';
    END IF;
    IF v_part = ANY(v_parts) OR (v_part = 'full' AND cardinality(v_parts) > 0) OR 'full' = ANY(v_parts) THEN
      RAISE EXCEPTION '1日の休みは「終日」1つか、「午前」「午後」それぞれ1つまでです。' USING ERRCODE = '22023';
    END IF;
    v_parts := v_parts || v_part;
  END LOOP;

  -- その日の有給・振休を消してから入れ直す（振替元の使用量はこの日の行を除いて数える）
  DELETE FROM "Assignments" a
   WHERE a."workerId" = v_worker_id AND a.date = p_date
     AND a."projectId" IS NULL AND public._leave_weight(a.title) IS NOT NULL;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_entries) LOOP
    v_title := v_entry->>'title';
    v_sub := NULL;

    IF v_title LIKE '振休%' THEN
      v_sub := NULLIF(v_entry->>'substitute_for_date', '')::date;
      IF v_sub IS NULL THEN
        RAISE EXCEPTION '振休は振替元（休日に出勤した日）を選んでください。' USING ERRCODE = '22023';
      END IF;
      IF v_sub = p_date THEN
        RAISE EXCEPTION '振替元に休みを取る日と同じ日は選べません。' USING ERRCODE = '22023';
      END IF;
      IF NOT public._is_non_working_day(v_sub) THEN
        RAISE EXCEPTION '振替元（%）は休業日ではありません。', v_sub USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM "TaskRecords" tr WHERE tr.worker_name = v_worker AND tr.date = v_sub) THEN
        RAISE EXCEPTION '振替元（%）に日報がありません。', v_sub USING ERRCODE = '22023';
      END IF;

      SELECT COALESCE(sum(public._leave_weight(a.title)), 0) INTO v_used
        FROM "Assignments" a
       WHERE a."workerId" = v_worker_id AND a.substitute_for_date = v_sub;
      v_new := public._leave_weight(v_title);
      IF v_used + v_new > 1.0 THEN
        RAISE EXCEPTION '振替元（%）は使える日数を超えています（1日分まで）。', v_sub USING ERRCODE = '22023';
      END IF;
    END IF;

    SELECT COALESCE(max(a.assignment_order), 0) + 1 INTO v_order
      FROM "Assignments" a
     WHERE a."workerId" = v_worker_id AND a.date = p_date;

    INSERT INTO "Assignments" (date, "workerId", "projectId", "projectTaskId", title, assignment_order, substitute_for_date)
    VALUES (p_date, v_worker_id, NULL, NULL, v_title, v_order, v_sub);
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'substitute_for_date', a.substitute_for_date,
           'assignment_order', a.assignment_order
         ) ORDER BY a.assignment_order), '[]'::jsonb)
    INTO v_result
    FROM "Assignments" a
   WHERE a."workerId" = v_worker_id AND a.date = p_date
     AND a."projectId" IS NULL AND public._leave_weight(a.title) IS NOT NULL;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_worker_day_leave(bigint, text, date, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_worker_day_leave(bigint, text, date, jsonb) TO authenticated;
