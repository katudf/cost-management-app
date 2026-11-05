-- =========================================================
-- 早出の時間と、残業承認に使う残業の合計を DB で求める
--
-- 【問題】
-- 20261105030000 では、早出の時間（TaskRecords.early_overtime_hours）と残業承認の時間を
-- 作業員画面が計算して送っていた。DB を先に新しくしたため、古い画面（PWA のキャッシュを含む）は
-- - 早出を送らない: 追加した行は早出 0、更新した行は早出が古い値のまま残る
-- - 残業承認に早出も含めた時間外の合計を送る: 早出だけの日にも承認申請が立つ
-- 今後、管理画面などから時刻を書き換える経路が増えても同じずれが起きる。
--
-- 【対処】
-- - 早出は開始・終了時刻と時間外の合計だけで決まるので、トリガーで毎回求める（送信値は使わない）。
--   定時開始は夏季・冬季とも 08:00。最初の休憩は 10:00 からなので、早出の時間帯に休憩はかからない。
--   終了が開始以前なら日をまたいだとみなす（画面の is_overnight の既定と同じ）。
-- - 残業承認の同期に使う残業の合計は、保存済みの日報（時間外 − 早出）から求める。
-- - このマイグレーションの前に古い画面から保存された分も、早出と承認待ちを直す。
-- =========================================================

-- ---------------------------------------------------------
-- 早出の時間（定時開始 08:00 より前の分。時間外の合計を超えない）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._calc_early_overtime_hours(p_start time, p_end time, p_overtime numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_start = p_end
      OR p_start >= time '08:00' OR COALESCE(p_overtime, 0) <= 0 THEN 0
    ELSE LEAST(
      p_overtime,
      round((
        LEAST(
          CASE WHEN p_end > p_start
               THEN EXTRACT(EPOCH FROM p_end) / 60
               ELSE EXTRACT(EPOCH FROM p_end) / 60 + 1440 END,
          480
        ) - EXTRACT(EPOCH FROM p_start) / 60
      )::numeric / 60, 2)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public._task_records_set_early_overtime()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.early_overtime_hours := public._calc_early_overtime_hours(NEW.start_time, NEW.end_time, NEW.overtime_hours);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS task_records_set_early_overtime ON public."TaskRecords";
CREATE TRIGGER task_records_set_early_overtime
  BEFORE INSERT OR UPDATE OF start_time, end_time, overtime_hours, early_overtime_hours
  ON public."TaskRecords"
  FOR EACH ROW
  EXECUTE FUNCTION public._task_records_set_early_overtime();

-- ---------------------------------------------------------
-- その現場・作業員・日付の残業（時間外 − 早出）の合計
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._late_overtime_total(p_project_id bigint, p_worker_name text, p_date date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(round(SUM(GREATEST(COALESCE(overtime_hours, 0) - early_overtime_hours, 0))::numeric, 2), 0)
    FROM public."TaskRecords"
   WHERE project_id = p_project_id AND worker_name = p_worker_name AND date = p_date;
$function$;

REVOKE EXECUTE ON FUNCTION public._late_overtime_total(bigint, text, date) FROM anon, PUBLIC, authenticated;

-- ---------------------------------------------------------
-- 既存データの直し（20261105030000 以降に古い画面から保存された分を含む）
-- ---------------------------------------------------------
UPDATE public."TaskRecords"
   SET early_overtime_hours = public._calc_early_overtime_hours(start_time, end_time, overtime_hours)
 WHERE early_overtime_hours IS DISTINCT FROM public._calc_early_overtime_hours(start_time, end_time, overtime_hours);

-- 承認待ちは残業だけの時間に直し、残業の無いものは取り下げる
UPDATE public."OvertimeApprovals" o
   SET requested_hours = public._late_overtime_total(o.project_id, o.worker_name, o.date),
       updated_at = now()
 WHERE o.status = 'pending'
   AND public._late_overtime_total(o.project_id, o.worker_name, o.date) > 0
   AND o.requested_hours IS DISTINCT FROM public._late_overtime_total(o.project_id, o.worker_name, o.date);

DELETE FROM public."OvertimeApprovals" o
 WHERE o.status = 'pending'
   AND public._late_overtime_total(o.project_id, o.worker_name, o.date) <= 0;

-- ---------------------------------------------------------
-- 日報の保存（20261105030000 版から、残業承認の同期に使う残業の合計を DB で求めるよう変更）
-- overtime[] は同期する現場と理由の指定にだけ使い、total は使わない
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_daily_report(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker text := NULLIF(btrim(p_payload->>'worker_name'), '');
  v_worker_id bigint := NULLIF(p_payload->>'worker_id', '')::bigint;
  v_project bigint := NULLIF(p_payload->>'project_id', '')::bigint;
  v_date date := NULLIF(p_payload->>'date', '')::date;
  v_privileged boolean := public.is_office_or_admin();
  v_foreman boolean;
  v_inserted jsonb := '[]'::jsonb;
  v_remapped jsonb := '[]'::jsonb;
  v_row jsonb;
  v_data jsonb;
  v_count integer;
  v_new_id bigint;
  v_ot_project bigint;
  v_approval_failed boolean := false;
BEGIN
  IF NOT (v_privileged OR public.current_staff_role() = 'worker') THEN
    RAISE EXCEPTION '日報を保存する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR v_project IS NULL OR v_date IS NULL THEN
    RAISE EXCEPTION '日報の保存内容が不正です。' USING ERRCODE = '22023';
  END IF;
  -- 職長判定: 申告された作業員名と worker_id が同じ人で、その人がこの現場の職長であること
  v_foreman := v_privileged OR public.is_declared_foreman(v_project, v_worker_id, v_worker);

  -- 削除（この作業員の日報に限る）
  DELETE FROM public."TaskRecords"
   WHERE worker_name = v_worker
     AND id IN (SELECT x::bigint FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x);

  -- 開始時刻を書き換える行は、先に開始時刻を外しておく（一意索引 task_records_worker_slot_key 対策）
  UPDATE public."TaskRecords" t
     SET start_time = NULL
   WHERE t.worker_name = v_worker
     AND t.id IN (
       SELECT (u->>'id')::bigint
         FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) u
        WHERE COALESCE(u->'data', '{}'::jsonb) ? 'start_time'
     );

  -- 更新（この作業員の日報に限る。指定されたキーだけ書き換える）
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) LOOP
    v_data := COALESCE(v_row->'data', '{}'::jsonb);
    UPDATE public."TaskRecords" t SET
      hours          = CASE WHEN v_data ? 'hours' THEN COALESCE((v_data->>'hours')::float8, 0) ELSE t.hours END,
      overtime_hours = CASE WHEN v_data ? 'overtime_hours' THEN COALESCE((v_data->>'overtime_hours')::numeric, 0) ELSE t.overtime_hours END,
      early_overtime_hours = CASE WHEN v_data ? 'early_overtime_hours' THEN COALESCE((v_data->>'early_overtime_hours')::numeric, 0) ELSE t.early_overtime_hours END,
      start_time     = CASE WHEN v_data ? 'start_time' THEN NULLIF(v_data->>'start_time', '')::time ELSE t.start_time END,
      end_time       = CASE WHEN v_data ? 'end_time' THEN NULLIF(v_data->>'end_time', '')::time ELSE t.end_time END,
      note           = CASE WHEN v_data ? 'note' THEN COALESCE(v_data->>'note', '') ELSE t.note END,
      work_allowance = CASE WHEN v_data ? 'work_allowance' THEN COALESCE((v_data->>'work_allowance')::boolean, false) ELSE t.work_allowance END
    WHERE t.id = (v_row->>'id')::bigint AND t.worker_name = v_worker;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- 管理者の削除などで対象が消えていたら、送信内容を正として追加し直す
    IF v_count = 0 AND v_row ? 'fallback_insert' THEN
      v_new_id := public._upsert_task_record(v_row->'fallback_insert', v_project, v_date, v_worker);
      v_remapped := v_remapped || jsonb_build_object('old_id', (v_row->>'id')::bigint, 'new_id', v_new_id);
    END IF;
  END LOOP;

  -- 追加（再送時は同じ時間枠の行を更新）
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'inserts', '[]'::jsonb)) LOOP
    v_new_id := public._upsert_task_record(v_row, v_project, v_date, v_worker);
    v_inserted := v_inserted || to_jsonb(v_new_id);
  END LOOP;

  -- 職長のみ: 進捗・協力業者
  IF jsonb_array_length(COALESCE(p_payload->'progress', '[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(p_payload->'deleted_subcontractor_ids', '[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(p_payload->'subcontractor_updates', '[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(p_payload->'subcontractor_inserts', '[]'::jsonb)) > 0 THEN
    IF NOT v_foreman THEN
      RAISE EXCEPTION '進捗と協力業者はこの現場の職長のみ登録できます。' USING ERRCODE = '42501';
    END IF;

    UPDATE public."ProjectTasks" pt
       SET progress_percentage = round((x->>'progress_percentage')::numeric)::bigint
      FROM jsonb_array_elements(COALESCE(p_payload->'progress', '[]'::jsonb)) x
     WHERE pt.id = (x->>'id')::bigint AND pt."projectId" = v_project;

    DELETE FROM public."SubcontractorRecords"
     WHERE project_id = v_project
       AND id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_payload->'deleted_subcontractor_ids', '[]'::jsonb)));

    UPDATE public."SubcontractorRecords" s
       SET company_name = x->>'company_name',
           worker_count = (x->>'worker_count')::numeric
      FROM jsonb_array_elements(COALESCE(p_payload->'subcontractor_updates', '[]'::jsonb)) x
     WHERE s.id::text = x->>'id' AND s.project_id = v_project;

    INSERT INTO public."SubcontractorRecords" AS s (id, project_id, date, company_name, worker_count, unit_price, worker_name)
    SELECT CASE WHEN x->>'client_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (x->>'client_id')::uuid ELSE gen_random_uuid() END,
           v_project, v_date, x->>'company_name', (x->>'worker_count')::numeric, 0, v_worker
      FROM jsonb_array_elements(COALESCE(p_payload->'subcontractor_inserts', '[]'::jsonb)) x
    ON CONFLICT (id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      worker_count = EXCLUDED.worker_count
    WHERE s.project_id = v_project AND s.date = v_date;
  END IF;

  -- 承認申請の同期。失敗しても日報の保存は取り消さない。
  BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'overtime', '[]'::jsonb)) LOOP
      v_ot_project := (v_row->>'project_id')::bigint;
      -- 保存中の現場か、この日にこの作業員の日報がある現場（休憩の再計算で残業が変わる現場）に限る
      CONTINUE WHEN v_ot_project IS DISTINCT FROM v_project AND NOT EXISTS (
        SELECT 1 FROM public."TaskRecords"
         WHERE project_id = v_ot_project AND worker_name = v_worker AND date = v_date
      );
      -- 残業の合計は送信値を使わず、保存済みの日報から求める（古い画面は早出も含めた値を送るため）
      PERFORM public._sync_overtime_approval(
        v_ot_project, v_worker, v_date,
        public._late_overtime_total(v_ot_project, v_worker, v_date), v_row->>'reason'
      );
    END LOOP;

    IF p_payload ? 'allowance_task_names' THEN
      PERFORM public._sync_work_allowance_approval(
        v_project, v_worker, v_date,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'allowance_task_names', '[]'::jsonb)))
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'save_daily_report: 承認申請の同期に失敗しました (%: %)', SQLSTATE, SQLERRM;
    v_approval_failed := true;
  END;

  RETURN jsonb_build_object(
    'inserted_ids', v_inserted,
    'remapped', v_remapped,
    'approval_sync_failed', v_approval_failed
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.save_daily_report(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_daily_report(jsonb) TO authenticated;
