-- =========================================================
-- 日報・職長機能・現場削除のデータ整合性を直す
--
-- 【問題】
-- 1. 作業員画面（worker ロールの共有アカウント）の職長機能が、RLS で書き込めない
--    テーブル（OvertimeApprovals / WorkAllowanceApprovals / SubcontractorRecords /
--    ProjectTasks）へ直接書き込んでいた。RLS で弾かれた UPDATE は 0 件で終わるため、
--    承認・進捗更新は「成功した」表示のまま何も変わらず、承認申請の起票・協力業者の
--    登録・作業項目の追加はエラーになっていた。協力業者は SELECT もできなかった。
-- 2. 日報の保存が「削除 → 更新 → 追加 → 協力業者」の別々のリクエストで、途中で失敗すると
--    追加済みの日報 id が画面に戻らず、再送で同じ日報が二重に登録されていた。
-- 3. オフライン下書きに残った他人の record_id を、作業員名で絞らずに UPDATE していた。
-- 4. 現場削除が子テーブルの削除と現場本体の削除を別々に行い、エラーも見ていなかった。
--    ゴミ箱の見積は RLS で project_id を外せず、現場本体の削除だけが FK 違反で失敗して
--    日報・配置・工種だけが消えることがあった。
--
-- 【対処】
-- - 職長の操作と日報の保存を SECURITY DEFINER の RPC にまとめ、1 トランザクションで実行する。
--   RPC 内でロールと職長（Projects.foreman_worker_id）を確認する。
--   ※ worker は共有アカウントで、作業員本人は画面で名前を選ぶ方式のため、
--     作業員名・作業員 ID はクライアント申告。RPC は「その申告の範囲を超える操作」を防ぐ。
-- - 時刻付きの日報に (worker_name, date, project_task_id, start_time) の一意索引を張り、
--   再送時の INSERT を UPSERT にして二重登録を防ぐ（2026-11-05 時点の本番に重複は 0 件）。
-- - 現場削除を RPC にまとめ、削除済み見積を含めて project_id を外してから削除する。
-- =========================================================

-- ---------------------------------------------------------
-- 共通ヘルパー
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_office_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_admin() OR public.current_staff_role() = 'office';
$function$;

-- 申告された作業員がその現場の職長か
CREATE OR REPLACE FUNCTION public.is_project_foreman(p_project_id bigint, p_worker_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_worker_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."Projects" WHERE id = p_project_id AND foreman_worker_id = p_worker_id
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_office_or_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_project_foreman(bigint, bigint) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_office_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_foreman(bigint, bigint) TO authenticated;

-- ---------------------------------------------------------
-- 協力業者: 職長画面で当日の協力業者を表示するため worker に SELECT を許可する
-- ---------------------------------------------------------
DROP POLICY IF EXISTS subcontractor_records_select_worker ON public."SubcontractorRecords";
CREATE POLICY subcontractor_records_select_worker ON public."SubcontractorRecords"
  FOR SELECT TO authenticated
  USING (public.current_staff_role() = 'worker');

-- ---------------------------------------------------------
-- 日報の二重登録防止（時刻付きの行のみ。管理者が時間数だけで入力した行は対象外）
-- ---------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS task_records_worker_slot_key
  ON public."TaskRecords" (worker_name, date, project_task_id, start_time)
  WHERE start_time IS NOT NULL;

-- ---------------------------------------------------------
-- 内部: 日報1行の追加（再送時は同じ時間枠の行を更新する）
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
    hours, overtime_hours, start_time, end_time, note, work_allowance
  ) VALUES (
    p_project_id, v_task_id, p_date, p_worker_name,
    COALESCE((p_row->>'hours')::float8, 0),
    COALESCE((p_row->>'overtime_hours')::numeric, 0),
    NULLIF(p_row->>'start_time', '')::time,
    NULLIF(p_row->>'end_time', '')::time,
    COALESCE(p_row->>'note', ''),
    COALESCE((p_row->>'work_allowance')::boolean, false)
  )
  ON CONFLICT (worker_name, date, project_task_id, start_time) WHERE start_time IS NOT NULL
  DO UPDATE SET
    hours = EXCLUDED.hours,
    overtime_hours = EXCLUDED.overtime_hours,
    end_time = EXCLUDED.end_time,
    note = EXCLUDED.note,
    work_allowance = EXCLUDED.work_allowance
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._upsert_task_record(jsonb, bigint, date, text) FROM anon, PUBLIC, authenticated;

-- ---------------------------------------------------------
-- 内部: 残業承認の同期（src/lib/overtimeApprovals.js の syncOvertimeApproval と同じ規則）
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
                          THEN NULL ELSE o.approved_hours END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._sync_overtime_approval(bigint, text, date, numeric, text) FROM anon, PUBLIC, authenticated;

-- ---------------------------------------------------------
-- 内部: 作業手当承認の同期（src/lib/workAllowanceApprovals.js の syncWorkAllowanceApproval と同じ規則）
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
                  THEN NULL ELSE w.approved_task_names END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._sync_work_allowance_approval(bigint, text, date, text[]) FROM anon, PUBLIC, authenticated;

-- ---------------------------------------------------------
-- 日報の保存（1 トランザクション）
--
-- p_payload:
--   worker_name, worker_id, project_id, date
--   delete_ids:      [bigint]                         この作業員の日報のみ削除
--   updates:         [{ id, data:{...}, fallback_insert?:{...} }]
--                    この作業員の日報のみ更新。対象が消えていて fallback_insert があれば追加し直す
--   inserts:         [{ project_task_id, hours, overtime_hours, start_time, end_time, note, work_allowance }]
--   progress:        [{ id, progress_percentage }]    職長のみ
--   deleted_subcontractor_ids / subcontractor_updates / subcontractor_inserts  職長のみ
--                    subcontractor_inserts: [{ client_id(uuid), company_name, worker_count }]
--   overtime:        [{ project_id, total, reason? }] 残業承認の同期（reason 省略時は既存を維持）
--   allowance_task_names: [text]                      作業手当承認の同期（キーがあるときだけ）
--
-- 戻り値: { inserted_ids:[bigint（inserts と同順）], remapped:[{old_id,new_id}], approval_sync_failed:boolean }
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
  v_approval_failed boolean := false;
BEGIN
  IF NOT (v_privileged OR public.current_staff_role() = 'worker') THEN
    RAISE EXCEPTION '日報を保存する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR v_project IS NULL OR v_date IS NULL THEN
    RAISE EXCEPTION '日報の保存内容が不正です。' USING ERRCODE = '22023';
  END IF;
  v_foreman := v_privileged OR public.is_project_foreman(v_project, v_worker_id);

  -- 削除（この作業員の日報に限る）
  DELETE FROM public."TaskRecords"
   WHERE worker_name = v_worker
     AND id IN (SELECT x::bigint FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x);

  -- 開始時刻を書き換える行は、先に開始時刻を外しておく。
  -- 1 行ずつ更新するため、2 つの枠の開始時刻を入れ替えるような編集で、途中の状態が
  -- 一意索引 task_records_worker_slot_key（開始時刻 NULL は対象外）にかかるのを防ぐ。
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

    -- 画面で振った UUID（client_id）をそのまま id にする。応答が届かず再送しても同じ行の更新で済み、二重登録にならない
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

  -- 承認申請の同期。失敗しても日報の保存は取り消さない（従来どおり日報を優先する）。
  -- 失敗した分だけをサブトランザクションで巻き戻し、approval_sync_failed で画面に知らせる。
  BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'overtime', '[]'::jsonb)) LOOP
      PERFORM public._sync_overtime_approval(
        (v_row->>'project_id')::bigint, v_worker, v_date,
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
-- 承認（職長・管理者）
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
          OR (public.current_staff_role() = 'worker' AND public.is_project_foreman(v_project, p_approver_worker_id))) THEN
    RAISE EXCEPTION '残業を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;

  UPDATE public."OvertimeApprovals"
     SET status = 'approved',
         approved_by = p_approver_name,
         approved_at = now(),
         approved_hours = requested_hours,
         updated_at = now()
   WHERE id = p_id;
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
          OR (public.current_staff_role() = 'worker' AND public.is_project_foreman(v_project, p_approver_worker_id))) THEN
    RAISE EXCEPTION '作業手当を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;

  UPDATE public."WorkAllowanceApprovals"
     SET status = 'approved',
         approved_by = p_approver_name,
         approved_at = now(),
         approved_task_names = task_names,
         updated_at = now()
   WHERE id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_work_allowance(bigint, text, bigint) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_work_allowance(bigint, text, bigint) TO authenticated;

-- ---------------------------------------------------------
-- 作業項目の追加（職長、または職長未設定の現場なら作業員も可）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_project_task(
  p_project_id bigint, p_name text, p_order bigint, p_worker_id bigint
)
RETURNS public."ProjectTasks"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_foreman boolean;
  v_row public."ProjectTasks";
BEGIN
  SELECT foreman_worker_id IS NOT NULL INTO v_has_foreman FROM public."Projects" WHERE id = p_project_id;
  IF v_has_foreman IS NULL THEN
    RAISE EXCEPTION '現場が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_office_or_admin()
          OR (public.current_staff_role() = 'worker'
              AND (NOT v_has_foreman OR public.is_project_foreman(p_project_id, p_worker_id)))) THEN
    RAISE EXCEPTION '作業項目の追加は職長のみ可能です。' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION '作業項目名を入力してください。' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."ProjectTasks" ("projectId", name, target_hours, estimated_amount, "order", progress_percentage)
  VALUES (p_project_id, btrim(p_name), 0, 0, COALESCE(p_order, 1), 0)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.add_project_task(bigint, text, bigint, bigint) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_project_task(bigint, text, bigint, bigint) TO authenticated;

-- ---------------------------------------------------------
-- 現場の削除（関連データの削除と見積の紐付け解除を 1 トランザクションで）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_project(p_project_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_office_or_admin() THEN
    RAISE EXCEPTION '現場を削除する権限がありません。' USING ERRCODE = '42501';
  END IF;

  -- ON DELETE NO ACTION の参照を先に外す（他は CASCADE で消える）
  DELETE FROM public."Assignments" WHERE "projectId" = p_project_id;
  DELETE FROM public."TaskRecords" WHERE project_id = p_project_id;
  DELETE FROM public."ProjectTasks" WHERE "projectId" = p_project_id;
  -- ゴミ箱の見積も含めて紐付けを外す（RLS では削除済み見積を更新できないため RPC で行う）
  UPDATE public.estimates SET project_id = NULL WHERE project_id = p_project_id;

  DELETE FROM public."Projects" WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '現場が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_project(bigint) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_project(bigint) TO authenticated;
