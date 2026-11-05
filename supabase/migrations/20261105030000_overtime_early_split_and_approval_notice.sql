-- =========================================================
-- 早出と残業を分ける / 承認されたことを申請者に知らせる
--
-- 【方針】
-- - 早出（定時開始前の時間外）は職長の承認を不要にする。時間外には引き続き数える。
--   承認が要るのは残業（定時終了後の時間外。日をまたいだ分を含む）だけ。
-- - TaskRecords.overtime_hours は従来どおり「時間外の合計（早出 + 残業）」のまま。
--   うち早出を early_overtime_hours に持つ（残業 = overtime_hours − early_overtime_hours）。
-- - OvertimeApprovals.requested_hours / approved_hours は「残業」の時間にする。
-- - 残業・作業手当の承認を、作業員画面で本人が「確認した」と押すまで知らせる。
--   確認した日時を acknowledged_at に持つ。承認が取り消されたら（時間が変わって承認待ちに
--   戻ったら）acknowledged_at も外し、次に承認されたときにまた知らせる。
--
-- 【既存データ】
-- - 開始・終了時刻のある日報は、時刻から早出の時間を計算して埋める
--   （定時開始は夏季・冬季とも 08:00。最初の休憩は 10:00 からなので、早出の時間帯に休憩はかからない）。
-- - 承認待ちの残業申請は、残業だけの時間に直す。早出しか無かった申請は削除する。
-- - 承認済みの申請は承認のまま残す。承認後に日報が変わっていない（承認時間 = 時間外の合計）ものは、
--   承認時間も残業だけの値に読み替える。読み替えないと、次に日報を送信したとき
--   「時間が変わった」と判定されて承認待ちに戻ってしまうため。
-- - 既存の承認済みの申請は、すべて確認済みとして扱う（過去の承認を一斉に知らせない）。
-- =========================================================

-- ---------------------------------------------------------
-- 列の追加
-- ---------------------------------------------------------
ALTER TABLE public."TaskRecords"
  ADD COLUMN IF NOT EXISTS early_overtime_hours numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public."TaskRecords".early_overtime_hours IS
  '時間外（overtime_hours）のうち早出（定時開始前）の時間。残業 = overtime_hours - early_overtime_hours';

ALTER TABLE public."OvertimeApprovals"
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
COMMENT ON COLUMN public."OvertimeApprovals".acknowledged_at IS
  '承認されたことを申請者本人が作業員画面で確認した日時。NULL かつ承認済みなら、お知らせを表示する';

ALTER TABLE public."WorkAllowanceApprovals"
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
COMMENT ON COLUMN public."WorkAllowanceApprovals".acknowledged_at IS
  '承認されたことを申請者本人が作業員画面で確認した日時。NULL かつ承認済みなら、お知らせを表示する';

-- 未確認のお知らせの取得用
CREATE INDEX IF NOT EXISTS idx_overtime_approvals_unacknowledged
  ON public."OvertimeApprovals" (worker_name)
  WHERE status = 'approved' AND acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_allowance_approvals_unacknowledged
  ON public."WorkAllowanceApprovals" (worker_name)
  WHERE status = 'approved' AND acknowledged_at IS NULL;

-- ---------------------------------------------------------
-- 既存データの移行
-- ---------------------------------------------------------
-- 早出の時間を時刻から埋める（日をまたぐ行は終了に 24 時間を足す。画面の is_overnight と同じ判定）
UPDATE public."TaskRecords" t
   SET early_overtime_hours = LEAST(
         COALESCE(t.overtime_hours, 0),
         round((
           LEAST(
             CASE WHEN t.end_time > t.start_time
                  THEN EXTRACT(EPOCH FROM t.end_time) / 60
                  ELSE EXTRACT(EPOCH FROM t.end_time) / 60 + 1440 END,
             480
           ) - EXTRACT(EPOCH FROM t.start_time) / 60
         )::numeric / 60, 2)
       )
 WHERE t.start_time IS NOT NULL
   AND t.end_time IS NOT NULL
   AND t.start_time <> t.end_time
   AND t.start_time < time '08:00'
   AND COALESCE(t.overtime_hours, 0) > 0;

-- 承認済みで、承認後に日報が変わっていないものは、承認時間を残業だけの値に読み替える
WITH sums AS (
  SELECT project_id, worker_name, date,
         round(SUM(COALESCE(overtime_hours, 0))::numeric, 2) AS total,
         round(SUM(COALESCE(overtime_hours, 0) - early_overtime_hours)::numeric, 2) AS late
    FROM public."TaskRecords"
   GROUP BY project_id, worker_name, date
)
UPDATE public."OvertimeApprovals" o
   SET requested_hours = s.late,
       approved_hours = s.late
  FROM sums s
 WHERE o.status = 'approved'
   AND s.project_id = o.project_id AND s.worker_name = o.worker_name AND s.date = o.date
   AND round(o.approved_hours::numeric, 2) = s.total
   AND s.late > 0;

-- 承認待ちは残業だけの時間に直す
WITH sums AS (
  SELECT project_id, worker_name, date,
         round(SUM(COALESCE(overtime_hours, 0) - early_overtime_hours)::numeric, 2) AS late
    FROM public."TaskRecords"
   GROUP BY project_id, worker_name, date
)
UPDATE public."OvertimeApprovals" o
   SET requested_hours = s.late,
       updated_at = now()
  FROM sums s
 WHERE o.status = 'pending'
   AND s.project_id = o.project_id AND s.worker_name = o.worker_name AND s.date = o.date
   AND s.late > 0;

-- 残業の無い承認待ち（早出だけ・日報が無い）は取り下げる
DELETE FROM public."OvertimeApprovals" o
 WHERE o.status = 'pending'
   AND NOT EXISTS (
     SELECT 1 FROM public."TaskRecords" t
      WHERE t.project_id = o.project_id AND t.worker_name = o.worker_name AND t.date = o.date
        AND COALESCE(t.overtime_hours, 0) - t.early_overtime_hours > 0
   );

-- 既存の承認済みは確認済みとして扱う
UPDATE public."OvertimeApprovals" SET acknowledged_at = now()
 WHERE status = 'approved' AND acknowledged_at IS NULL;
UPDATE public."WorkAllowanceApprovals" SET acknowledged_at = now()
 WHERE status = 'approved' AND acknowledged_at IS NULL;

-- ---------------------------------------------------------
-- 内部: 日報1行の追加（20261105010000 版に early_overtime_hours を追加）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._upsert_task_record(
  p_row jsonb, p_project_id bigint, p_date date, p_worker_name text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task_id bigint := (p_row->>'project_task_id')::bigint;
  v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."ProjectTasks" WHERE id = v_task_id AND "projectId" = p_project_id) THEN
    RAISE EXCEPTION '作業項目がこの現場にありません (task_id=%)', v_task_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."TaskRecords" (
    project_id, project_task_id, date, worker_name,
    hours, overtime_hours, early_overtime_hours, start_time, end_time, note, work_allowance
  ) VALUES (
    p_project_id, v_task_id, p_date, p_worker_name,
    COALESCE((p_row->>'hours')::float8, 0),
    COALESCE((p_row->>'overtime_hours')::numeric, 0),
    COALESCE((p_row->>'early_overtime_hours')::numeric, 0),
    NULLIF(p_row->>'start_time', '')::time,
    NULLIF(p_row->>'end_time', '')::time,
    COALESCE(p_row->>'note', ''),
    COALESCE((p_row->>'work_allowance')::boolean, false)
  )
  ON CONFLICT (worker_name, date, project_task_id, start_time) WHERE start_time IS NOT NULL
  DO UPDATE SET
    hours = EXCLUDED.hours,
    overtime_hours = EXCLUDED.overtime_hours,
    early_overtime_hours = EXCLUDED.early_overtime_hours,
    end_time = EXCLUDED.end_time,
    note = EXCLUDED.note,
    work_allowance = EXCLUDED.work_allowance
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._upsert_task_record(jsonb, bigint, date, text) FROM anon, PUBLIC, authenticated;

-- ---------------------------------------------------------
-- 内部: 残業承認の同期（20261105010000 版に、承認の取り消し時に「本人確認済み」も外す処理を追加）
--   p_total は残業（終業後）の合計。早出は含めない
--   残業 0 → 申請を削除 / 無ければ pending で起票 / 承認済みで時間が変わったら pending に戻す
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sync_overtime_approval(
  p_project_id bigint, p_worker_name text, p_date date, p_total numeric, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(p_total, 0) <= 0 THEN
    DELETE FROM public."OvertimeApprovals"
     WHERE project_id = p_project_id AND worker_name = p_worker_name AND date = p_date;
    RETURN;
  END IF;

  INSERT INTO public."OvertimeApprovals" AS o (project_id, worker_name, date, status, requested_hours, reason)
  VALUES (p_project_id, p_worker_name, p_date, 'pending', p_total, p_reason)
  ON CONFLICT (project_id, worker_name, date) DO UPDATE SET
    requested_hours = EXCLUDED.requested_hours,
    reason = COALESCE(EXCLUDED.reason, o.reason),
    updated_at = now(),
    status = CASE WHEN o.status = 'approved' AND o.approved_hours IS DISTINCT FROM EXCLUDED.requested_hours
                  THEN 'pending' ELSE o.status END,
    approved_by = CASE WHEN o.status = 'approved' AND o.approved_hours IS DISTINCT FROM EXCLUDED.requested_hours
                       THEN NULL ELSE o.approved_by END,
    approved_at = CASE WHEN o.status = 'approved' AND o.approved_hours IS DISTINCT FROM EXCLUDED.requested_hours
                       THEN NULL ELSE o.approved_at END,
    approved_hours = CASE WHEN o.status = 'approved' AND o.approved_hours IS DISTINCT FROM EXCLUDED.requested_hours
                          THEN NULL ELSE o.approved_hours END,
    acknowledged_at = CASE WHEN o.status = 'approved' AND o.approved_hours IS DISTINCT FROM EXCLUDED.requested_hours
                           THEN NULL ELSE o.acknowledged_at END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._sync_overtime_approval(bigint, text, date, numeric, text) FROM anon, PUBLIC, authenticated;

-- ---------------------------------------------------------
-- 内部: 作業手当承認の同期（20261105010000 版に、承認の取り消し時に「本人確認済み」も外す処理を追加）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sync_work_allowance_approval(
  p_project_id bigint, p_worker_name text, p_date date, p_task_names text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_names text[] := ARRAY(SELECT n FROM unnest(COALESCE(p_task_names, '{}')) n WHERE COALESCE(n, '') <> '');
  v_sorted text[] := ARRAY(SELECT n FROM unnest(v_names) n ORDER BY n);
BEGIN
  IF cardinality(v_names) = 0 THEN
    DELETE FROM public."WorkAllowanceApprovals"
     WHERE project_id = p_project_id AND worker_name = p_worker_name AND date = p_date;
    RETURN;
  END IF;

  INSERT INTO public."WorkAllowanceApprovals" AS w (project_id, worker_name, date, status, task_names)
  VALUES (p_project_id, p_worker_name, p_date, 'pending', v_names)
  ON CONFLICT (project_id, worker_name, date) DO UPDATE SET
    task_names = EXCLUDED.task_names,
    updated_at = now(),
    status = CASE WHEN w.status = 'approved'
                   AND ARRAY(SELECT n FROM unnest(COALESCE(w.approved_task_names, '{}')) n ORDER BY n) IS DISTINCT FROM v_sorted
                  THEN 'pending' ELSE w.status END,
    approved_by = CASE WHEN w.status = 'approved'
                   AND ARRAY(SELECT n FROM unnest(COALESCE(w.approved_task_names, '{}')) n ORDER BY n) IS DISTINCT FROM v_sorted
                  THEN NULL ELSE w.approved_by END,
    approved_at = CASE WHEN w.status = 'approved'
                   AND ARRAY(SELECT n FROM unnest(COALESCE(w.approved_task_names, '{}')) n ORDER BY n) IS DISTINCT FROM v_sorted
                  THEN NULL ELSE w.approved_at END,
    approved_task_names = CASE WHEN w.status = 'approved'
                   AND ARRAY(SELECT n FROM unnest(COALESCE(w.approved_task_names, '{}')) n ORDER BY n) IS DISTINCT FROM v_sorted
                  THEN NULL ELSE w.approved_task_names END,
    acknowledged_at = CASE WHEN w.status = 'approved'
                   AND ARRAY(SELECT n FROM unnest(COALESCE(w.approved_task_names, '{}')) n ORDER BY n) IS DISTINCT FROM v_sorted
                  THEN NULL ELSE w.acknowledged_at END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._sync_work_allowance_approval(bigint, text, date, text[]) FROM anon, PUBLIC, authenticated;

-- ---------------------------------------------------------
-- 日報の保存（20261105020000 版に、早出の時間 early_overtime_hours の保存を追加）
-- p_payload の形・戻り値は従来どおり。updates[].data / inserts[] に early_overtime_hours を渡せる。
-- overtime[].total は「残業（終業後）」の合計。早出は承認不要なので含めない
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
      PERFORM public._sync_overtime_approval(
        v_ot_project, v_worker, v_date,
        COALESCE((v_row->>'total')::numeric, 0), v_row->>'reason'
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

-- ---------------------------------------------------------
-- 承認（職長・管理者）: 20261105020000 版に、本人へのお知らせ（acknowledged_at）の初期化を追加
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_overtime(p_id bigint, p_approver_name text, p_approver_worker_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project bigint;
BEGIN
  SELECT project_id INTO v_project FROM public."OvertimeApprovals" WHERE id = p_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION '残業申請が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_office_or_admin()
          OR (public.current_staff_role() = 'worker'
              AND public.is_declared_foreman(v_project, p_approver_worker_id, p_approver_name))) THEN
    RAISE EXCEPTION '残業を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;

  UPDATE public."OvertimeApprovals"
     SET status = 'approved',
         approved_by = p_approver_name,
         approved_at = now(),
         approved_hours = requested_hours,
         -- 自分の申請を自分で承認したときは知らせる必要がないので、確認済みにしておく
         acknowledged_at = CASE WHEN btrim(worker_name) = btrim(p_approver_name) THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'この残業申請は承認待ちではありません。' USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_work_allowance(p_id bigint, p_approver_name text, p_approver_worker_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project bigint;
BEGIN
  SELECT project_id INTO v_project FROM public."WorkAllowanceApprovals" WHERE id = p_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION '作業手当の申請が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_office_or_admin()
          OR (public.current_staff_role() = 'worker'
              AND public.is_declared_foreman(v_project, p_approver_worker_id, p_approver_name))) THEN
    RAISE EXCEPTION '作業手当を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;

  UPDATE public."WorkAllowanceApprovals"
     SET status = 'approved',
         approved_by = p_approver_name,
         approved_at = now(),
         approved_task_names = task_names,
         acknowledged_at = CASE WHEN btrim(worker_name) = btrim(p_approver_name) THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'この作業手当の申請は承認待ちではありません。' USING ERRCODE = '22023';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_work_allowance(bigint, text, bigint) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_work_allowance(bigint, text, bigint) TO authenticated;

-- ---------------------------------------------------------
-- 承認のお知らせを本人が確認した（作業員画面の「確認した」）
--   申告された作業員名と ID が同じ人のときだけ、その人の承認済みの申請を確認済みにする
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_approvals(
  p_worker_name text, p_worker_id bigint, p_overtime_ids bigint[], p_allowance_ids bigint[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker text := NULLIF(btrim(p_worker_name), '');
BEGIN
  IF NOT (public.is_office_or_admin() OR public.current_staff_role() = 'worker') THEN
    RAISE EXCEPTION 'お知らせを確認する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR NOT public.is_declared_worker(p_worker_id, v_worker) THEN
    RAISE EXCEPTION '作業員の情報が名簿と一致しません。画面を読み込み直してください。' USING ERRCODE = '42501';
  END IF;

  UPDATE public."OvertimeApprovals"
     SET acknowledged_at = now()
   WHERE id = ANY(COALESCE(p_overtime_ids, '{}'))
     AND btrim(worker_name) = v_worker
     AND status = 'approved'
     AND acknowledged_at IS NULL;

  UPDATE public."WorkAllowanceApprovals"
     SET acknowledged_at = now()
   WHERE id = ANY(COALESCE(p_allowance_ids, '{}'))
     AND btrim(worker_name) = v_worker
     AND status = 'approved'
     AND acknowledged_at IS NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.acknowledge_approvals(text, bigint, bigint[], bigint[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_approvals(text, bigint, bigint[], bigint[]) TO authenticated;
