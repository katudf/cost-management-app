-- =========================================================
-- 日報レビューの指摘対応（20261105010000_daily_report_integrity_rpcs の続き）
--
-- 【問題】
-- 1. 作業員画面の「この現場の入力記録を削除」が TaskRecords を直接削除するだけで、
--    残業・作業手当の承認申請（OvertimeApprovals / WorkAllowanceApprovals）が残っていた。
--    日報のない日の申請が承認待ち・承認済みのまま残り、承認一覧や集計に混ざる。
-- 2. save_daily_report / approve_* の職長判定が worker_id だけを見ていた。
--    作業員名と worker_id の組み合わせを確かめないため、名前は本人のまま
--    職長の worker_id を送ると職長の操作（進捗・協力業者・承認）が通った。
-- 3. save_daily_report の残業申請の同期が、送られた project_id をそのまま使っていた。
--    同じ作業員・同じ日の、日報のない現場の申請（承認済みを含む）まで消せた。
-- 4. approve_* が申請の状態を見ず、承認待ちでない申請も承認済みに書き換えていた。
--
-- 【対処】
-- - 現場単位の削除を RPC delete_worker_project_day にし、承認申請の削除と 1 トランザクションで行う。
-- - 申告された作業員名と worker_id が Workers 上で同じ人かを確かめる is_declared_worker と、
--   それを含めた職長判定 is_declared_foreman を追加し、職長の操作（日報の進捗・協力業者、承認、
--   作業項目の追加）はすべて is_declared_foreman で判定する。
--   add_project_task は作業員名の引数 p_worker_name を追加する（省略時は職長の操作を受け付けない）。
-- - 残業申請の同期は「保存中の現場」か「その日にこの作業員の日報がある現場」に限る。
-- - 承認は status = 'pending' の申請だけを対象にする。
-- =========================================================

-- ---------------------------------------------------------
-- 申告された作業員名と作業員 ID が同じ人か（共有アカウントの申告値どうしの整合だけを見る）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_declared_worker(p_worker_id bigint, p_worker_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_worker_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."Workers"
     WHERE id = p_worker_id AND btrim(name) = btrim(p_worker_name)
  );
$function$;

-- 申告された作業員（名前と ID の組）が、その現場の職長か。職長の操作の判定はすべてここを通す
CREATE OR REPLACE FUNCTION public.is_declared_foreman(p_project_id bigint, p_worker_id bigint, p_worker_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_declared_worker(p_worker_id, p_worker_name)
     AND public.is_project_foreman(p_project_id, p_worker_id);
$function$;

REVOKE EXECUTE ON FUNCTION public.is_declared_worker(bigint, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_declared_worker(bigint, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_declared_foreman(bigint, bigint, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_declared_foreman(bigint, bigint, text) TO authenticated;

-- ---------------------------------------------------------
-- 作業員・現場・日付単位の日報削除（承認申請も一緒に消す）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_worker_project_day(
  p_project_id bigint, p_worker_name text, p_date date
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
    RAISE EXCEPTION '日報を削除する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR p_project_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION '削除する日報の指定が不正です。' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."TaskRecords"
   WHERE project_id = p_project_id AND worker_name = v_worker AND date = p_date;
  -- 日報が無くなった日の申請は、承認済みでも残さない（save_daily_report の「残業 0 なら削除」と同じ扱い）
  DELETE FROM public."OvertimeApprovals"
   WHERE project_id = p_project_id AND worker_name = v_worker AND date = p_date;
  DELETE FROM public."WorkAllowanceApprovals"
   WHERE project_id = p_project_id AND worker_name = v_worker AND date = p_date;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_worker_project_day(bigint, text, date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_worker_project_day(bigint, text, date) TO authenticated;

-- ---------------------------------------------------------
-- 日報の保存（20261105010000 版から、職長判定と残業同期の範囲だけを変更）
-- p_payload の形・戻り値は従来どおり
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
-- 承認（職長・管理者）: 承認者の名前と ID の整合を確かめ、承認待ちの申請だけを承認する
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
-- 作業項目の追加（職長、または職長未設定の現場なら作業員も可）
-- 作業員名 p_worker_name を受け取り、職長の判定を is_declared_foreman で行う。
-- 旧版（引数 4 つ）は ID だけで職長と判定できてしまうため削除する。
-- p_worker_name を省略した古い画面からの呼び出しも、この関数で受ける（職長の判定には通らない）。
-- ---------------------------------------------------------
DROP FUNCTION IF EXISTS public.add_project_task(bigint, text, bigint, bigint);

CREATE OR REPLACE FUNCTION public.add_project_task(
  p_project_id bigint, p_name text, p_order bigint, p_worker_id bigint, p_worker_name text DEFAULT NULL
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
              AND (NOT v_has_foreman OR public.is_declared_foreman(p_project_id, p_worker_id, p_worker_name)))) THEN
    RAISE EXCEPTION '作業項目の追加は職長のみ可能です。（画面が古い場合は読み込み直してください）' USING ERRCODE = '42501';
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

REVOKE EXECUTE ON FUNCTION public.add_project_task(bigint, text, bigint, bigint, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_project_task(bigint, text, bigint, bigint, text) TO authenticated;
