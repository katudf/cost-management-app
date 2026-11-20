-- =========================================================
-- 日報の保存・承認の RPC を、権限とデータ整合性の面で直す（互換のある追加だけ）
-- （docs/specs/daily-report-db-hardening.md M2。DB-2・DB-4・DB-5・DB-6・DB-7・DB-9 の DB 側の準備）
--
-- 【問題】
-- DB-4: save_daily_report の削除・更新が作業員名と id だけで絞られ、画面に別の日・別の現場の record_id が
--       残ったまま送られると、その日の行が書き換わる・消える（更新対象が無ければ fallback_insert で追加し直す）。
-- DB-5: 楽観ロックが無く、画面を開いた後に管理者が直した時間や職長の進捗を、古い値で上書きする。
-- DB-6: 承認の RPC が「職長が画面で見た値」を受け取らず、見ていない時間で承認されうる。
-- DB-7: 休憩設定を日報の保存とは別のリクエストで保存しており、後半だけ失敗すると食い違う。
-- DB-2・DB-9 の準備: 作業員画面の配置表は全員分の TaskRecords を直接読み、現場一覧は Projects の全列を読んでいる。
--
-- 【対処】
-- - TaskRecords に updated_at を足し、UPDATE のたびにトリガーで now() を入れる。
-- - save_daily_report:
--   * 削除・開始時刻を外す更新・画面の入力の更新は、この作業員・この現場・この日の行に限る。
--     休憩の再計算（時間の列だけの更新）は、同じ日なら他の現場の行も対象にする。
--     行はあるのに絞り込みで外れたら、何も保存せずに 22023 を返す。
--   * expected_versions（{ "<record_id>": "<updated_at>" }）が送られたら、触る行をロックして版を比べる。
--     違う・更新しようとした行が消えている → 何も保存せずに PT409（HTTP 409）。DETAIL に競合の一覧。
--     progress[].expected_progress も同様に比べる（職長のみ）。
--   * break_durations が送られたら、休憩設定を同じトランザクションで保存する。
--   * 戻り値に break_saved と versions（この作業員・この日の全行の updated_at）を足す。
--   * 作業員を決められないとき（20261120000000 の後の閲覧者など）は 42501 を返す。
-- - approve_overtime / approve_work_allowance に「画面で見た値」の引数を足す（DEFAULT NULL。旧画面の 3 引数の呼び出しも当たる）。
--   違えば承認せずに PT409。古い 3 引数版は、PostgREST が候補を決められなくなるので DROP する。
-- - 作業員の配置表用に get_task_record_presence（時間を含まない「出た現場」）を足す。
-- - 金額・顧客・PDF の列を含まない現場の名簿ビュー projects_directory を足す。
-- - RLS（M3）で使う current_worker_name() / my_foreman_project_ids() を足す。
--
-- 旧画面の payload（expected_versions・break_durations・expected_progress が無い）は、
-- 現場・日付の絞り込み以外は従来どおり動く（版が無ければ比べず、消えていた行は fallback_insert で追加し直す）。
--
-- 【巻き戻し】save_daily_report を 20261107020000 の定義で作り直す。approve_* は 5 引数版を DROP し、
-- 20261107020000 の 3 引数版を作り直す。追加した列・トリガー・関数・ビューは残してよい。
-- =========================================================

-- ---------------------------------------------------------
-- TaskRecords.updated_at（楽観ロック用）
-- ---------------------------------------------------------
ALTER TABLE public."TaskRecords"
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN public."TaskRecords".updated_at IS
  '最後に更新した日時（楽観ロック用。UPDATE のたびにトリガーで入れる）';

CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._touch_updated_at() FROM anon, PUBLIC, authenticated;

DROP TRIGGER IF EXISTS task_records_touch_updated_at ON public."TaskRecords";
CREATE TRIGGER task_records_touch_updated_at
  BEFORE UPDATE ON public."TaskRecords"
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ---------------------------------------------------------
-- RLS で使う部品（M3 で使う。ポリシーの中では (SELECT ...) で囲んで 1 回だけ評価させる）
-- ---------------------------------------------------------
-- ログイン中の作業員の名前（btrim 済み）。作業員でなければ NULL
CREATE OR REPLACE FUNCTION public.current_worker_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(btrim(w.name), '') FROM "Workers" w WHERE w.id = public.current_worker_id();
$$;

-- ログイン中の作業員が職長の現場の id。作業員でなければ空配列
CREATE OR REPLACE FUNCTION public.my_foreman_project_ids()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(p.id), '{}')
    FROM "Projects" p
   WHERE p.foreman_worker_id IS NOT NULL
     AND p.foreman_worker_id = public.current_worker_id();
$$;

REVOKE EXECUTE ON FUNCTION public.current_worker_name() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_foreman_project_ids() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_worker_name() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_foreman_project_ids() TO authenticated;

-- ---------------------------------------------------------
-- 作業員の配置表用: 期間内に日報がある（現場・作業員名・日付）の組だけを返す。時間・メモは返さない
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_task_record_presence(p_start date, p_end date)
RETURNS TABLE (project_id bigint, worker_name text, date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_office_or_admin() OR public.is_personal_worker()) THEN
    RAISE EXCEPTION '実績を参照する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 62 THEN
    RAISE EXCEPTION '期間の指定が不正です。' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT DISTINCT t.project_id, t.worker_name, t.date
      FROM "TaskRecords" t
     WHERE t.date BETWEEN p_start AND p_end;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_task_record_presence(date, date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_task_record_presence(date, date) TO authenticated;

-- ---------------------------------------------------------
-- 現場の名簿ビュー（金額・顧客・PDF の列を含めない）。workers_directory と同じく security_invoker を付けず、
-- ビュー側の WHERE で認可する（担当者・閲覧者は is_staff()、作業員は is_personal_worker()）
-- ---------------------------------------------------------
CREATE OR REPLACE VIEW public.projects_directory AS
  SELECT id, created_at, name, short_name, status, "startDate", "endDate",
         foreman_worker_id, bar_color, display_order, "order", show_on_home
    FROM public."Projects"
   WHERE public.is_staff() OR public.is_personal_worker();

REVOKE ALL ON public.projects_directory FROM anon, PUBLIC;
GRANT SELECT ON public.projects_directory TO authenticated;

-- ---------------------------------------------------------
-- 日報の保存（20261107020000 版に、現場・日付の絞り込み、楽観ロック、休憩設定の保存を追加）
-- p_payload に足したキー（どれも省略できる）:
--   expected_versions : { "<record_id>": "<画面が読んだ updated_at>" }。delete_ids と updates の行を比べる
--   progress[].expected_progress : 画面が読んだ進捗。職長の進捗の上書きを防ぐ
--   break_durations   : 休憩設定（分の配列。3 つまで、0〜180）
-- 戻り値に足したキー: break_saved（休憩設定を保存したか）、versions（{ "<record_id>": "<updated_at>" }）
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_daily_report(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker text;
  v_worker_id bigint;
  v_project bigint := NULLIF(p_payload->>'project_id', '')::bigint;
  v_date date := NULLIF(p_payload->>'date', '')::date;
  v_privileged boolean := public.is_office_or_admin();
  v_foreman boolean;
  v_inserted jsonb := '[]'::jsonb;
  v_remapped jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_row jsonb;
  v_data jsonb;
  v_count integer;
  v_new_id bigint;
  v_ot_project bigint;
  v_approval_failed boolean := false;
  v_recalc_only boolean;
  v_breaks jsonb;
  v_break_saved boolean := false;
BEGIN
  IF NOT (v_privileged OR COALESCE(public.current_staff_role() = 'worker', false)) THEN
    RAISE EXCEPTION '日報を保存する権限がありません。' USING ERRCODE = '42501';
  END IF;
  -- 作業員アカウントは送られた作業員名・ID を使わず本人にする（担当者は代理入力として申告どおり）
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(NULLIF(p_payload->>'worker_id', '')::bigint, p_payload->>'worker_name') e;
  IF v_worker IS NULL THEN
    IF v_privileged THEN
      RAISE EXCEPTION '日報の保存内容が不正です。' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION '日報を保存する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF v_project IS NULL OR v_date IS NULL THEN
    RAISE EXCEPTION '日報の保存内容が不正です。' USING ERRCODE = '22023';
  END IF;
  -- 職長判定: 作業員名と worker_id が同じ人で、その人がこの現場の職長であること
  v_foreman := v_privileged OR public.is_declared_foreman(v_project, v_worker_id, v_worker);

  -- ---------- 楽観ロック（書き込みより前に 1 回だけ確かめる） ----------
  -- 触る行をロックし、確かめてから書き込むまでの間に他の人が書き換えられないようにする
  PERFORM 1 FROM public."TaskRecords" t
   WHERE t.worker_name = v_worker
     AND t.id IN (
       SELECT x::bigint FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x
       UNION
       SELECT (u->>'id')::bigint FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) u
     )
   FOR UPDATE;

  IF jsonb_typeof(p_payload->'expected_versions') = 'object' THEN
    WITH touched AS (
      SELECT x::bigint AS id, false AS is_update
        FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x
      UNION ALL
      SELECT (u->>'id')::bigint, true
        FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) u
    ), expected AS (
      SELECT t.id, bool_or(t.is_update) AS is_update,
             (p_payload->'expected_versions'->>t.id::text)::timestamptz AS v
        FROM touched t
       WHERE p_payload->'expected_versions' ? t.id::text
       GROUP BY t.id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind', 'task_record',
             'id', e.id,
             'reason', CASE WHEN r.id IS NULL THEN 'deleted' ELSE 'updated' END,
             'current_updated_at', r.updated_at) ORDER BY e.id), '[]'::jsonb)
      INTO v_conflicts
      FROM expected e
      LEFT JOIN public."TaskRecords" r ON r.id = e.id AND r.worker_name = v_worker
     -- 消そうとした行が既に無いのは競合にしない（結果は同じ）。更新しようとした行が無いのは競合
     WHERE (r.id IS NULL AND e.is_update)
        OR (r.id IS NOT NULL AND r.updated_at IS DISTINCT FROM e.v);
  END IF;

  -- 進捗（職長のみ）: 読んだときの値が送られていれば比べる
  IF v_foreman THEN
    SELECT v_conflicts || COALESCE(jsonb_agg(jsonb_build_object(
             'kind', 'progress', 'id', pt.id,
             'reason', 'updated', 'current', pt.progress_percentage) ORDER BY pt.id), '[]'::jsonb)
      INTO v_conflicts
      FROM jsonb_array_elements(COALESCE(p_payload->'progress', '[]'::jsonb)) x
      JOIN public."ProjectTasks" pt ON pt.id = (x->>'id')::bigint AND pt."projectId" = v_project
     WHERE x ? 'expected_progress'
       AND pt.progress_percentage IS DISTINCT FROM NULLIF(x->>'expected_progress', '')::bigint;
  END IF;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    -- PT409: PostgREST が HTTP 409 で返す（独自の SQLSTATE）。DETAIL に競合した行を入れる
    RAISE EXCEPTION '他の人が先にこの日報か進捗を直しました。読み込み直してから、もう一度入力してください。'
      USING ERRCODE = 'PT409', DETAIL = v_conflicts::text;
  END IF;

  -- ---------- 削除（この作業員・この現場・この日の日報に限る） ----------
  DELETE FROM public."TaskRecords"
   WHERE worker_name = v_worker
     AND project_id = v_project
     AND date = v_date
     AND id IN (SELECT x::bigint FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x);

  -- 開始時刻を書き換える行は、先に開始時刻を外しておく（一意索引 task_records_worker_slot_key 対策）
  UPDATE public."TaskRecords" t
     SET start_time = NULL
   WHERE t.worker_name = v_worker
     AND t.project_id = v_project
     AND t.date = v_date
     AND t.id IN (
       SELECT (u->>'id')::bigint
         FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) u
        WHERE COALESCE(u->'data', '{}'::jsonb) ? 'start_time'
     );

  -- ---------- 更新（指定されたキーだけ書き換える） ----------
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) LOOP
    v_data := COALESCE(v_row->'data', '{}'::jsonb);
    -- 休憩の再計算（時間の列だけの書き換え）なら、同じ日の他の現場の行も対象にする
    v_recalc_only := NOT (v_row ? 'fallback_insert')
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_data) k
         WHERE k NOT IN ('hours', 'overtime_hours', 'early_overtime_hours')
      );

    UPDATE public."TaskRecords" t SET
      hours          = CASE WHEN v_data ? 'hours' THEN COALESCE((v_data->>'hours')::float8, 0) ELSE t.hours END,
      overtime_hours = CASE WHEN v_data ? 'overtime_hours' THEN COALESCE((v_data->>'overtime_hours')::numeric, 0) ELSE t.overtime_hours END,
      early_overtime_hours = CASE WHEN v_data ? 'early_overtime_hours' THEN COALESCE((v_data->>'early_overtime_hours')::numeric, 0) ELSE t.early_overtime_hours END,
      start_time     = CASE WHEN v_data ? 'start_time' THEN NULLIF(v_data->>'start_time', '')::time ELSE t.start_time END,
      end_time       = CASE WHEN v_data ? 'end_time' THEN NULLIF(v_data->>'end_time', '')::time ELSE t.end_time END,
      note           = CASE WHEN v_data ? 'note' THEN COALESCE(v_data->>'note', '') ELSE t.note END,
      work_allowance = CASE WHEN v_data ? 'work_allowance' THEN COALESCE((v_data->>'work_allowance')::boolean, false) ELSE t.work_allowance END
    WHERE t.id = (v_row->>'id')::bigint
      AND t.worker_name = v_worker
      AND t.date = v_date
      AND (t.project_id = v_project OR v_recalc_only);
    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count = 0 THEN
      IF EXISTS (SELECT 1 FROM public."TaskRecords" t
                  WHERE t.id = (v_row->>'id')::bigint AND t.worker_name = v_worker) THEN
        -- 行はあるが別の日・別の現場（画面に古い入力が残っている）。何も保存しない
        RAISE EXCEPTION '別の日か別の現場の日報を書き換えようとしました。画面を読み込み直してから送信してください。'
          USING ERRCODE = '22023', DETAIL = format('record_id=%s', v_row->>'id');
      ELSIF v_row ? 'fallback_insert' THEN
        -- 管理者の削除などで対象が消えていた。版が送られていれば上の楽観ロックで止まっているので、ここに来るのは旧画面だけ
        v_new_id := public._upsert_task_record(v_row->'fallback_insert', v_project, v_date, v_worker);
        v_remapped := v_remapped || jsonb_build_object('old_id', (v_row->>'id')::bigint, 'new_id', v_new_id);
      END IF;
    END IF;
  END LOOP;

  -- ---------- 追加（再送時は同じ時間枠の行を更新） ----------
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'inserts', '[]'::jsonb)) LOOP
    v_new_id := public._upsert_task_record(v_row, v_project, v_date, v_worker);
    v_inserted := v_inserted || to_jsonb(v_new_id);
  END LOOP;

  -- ---------- 休憩設定（作業員・日付単位）。キーがあるときだけ保存する ----------
  IF p_payload ? 'break_durations' THEN
    v_breaks := p_payload->'break_durations';
    -- 配列でない値に配列の関数を使わないよう、型の確認を先に分けて行う（OR の評価順には頼らない）
    IF jsonb_typeof(v_breaks) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '休憩設定の内容が不正です。' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_breaks) > 3
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_breaks) b
          WHERE CASE WHEN jsonb_typeof(b) = 'number'
                     THEN (b #>> '{}')::numeric NOT BETWEEN 0 AND 180
                     ELSE true END
       ) THEN
      RAISE EXCEPTION '休憩設定の内容が不正です。' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public."WorkerDailyBreakSettings" (worker_name, date, break_durations, updated_at)
    VALUES (v_worker, v_date, v_breaks, now())
    ON CONFLICT (worker_name, date) DO UPDATE SET
      break_durations = EXCLUDED.break_durations,
      updated_at = now();
    v_break_saved := true;
  END IF;

  -- ---------- 職長のみ: 進捗・協力業者（20261107020000 と同じ） ----------
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

  -- ---------- 承認申請の同期（20261107020000 と同じ）。失敗しても日報の保存は取り消さない ----------
  BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'overtime', '[]'::jsonb)) LOOP
      v_ot_project := (v_row->>'project_id')::bigint;
      -- 保存中の現場か、この日にこの作業員の日報がある現場（休憩の再計算で残業が変わる現場）に限る
      CONTINUE WHEN v_ot_project IS DISTINCT FROM v_project AND NOT EXISTS (
        SELECT 1 FROM public."TaskRecords"
         WHERE project_id = v_ot_project AND worker_name = v_worker AND date = v_date
      );
      -- 残業の合計は送信値を使わず、保存済みの日報から求める
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
    'approval_sync_failed', v_approval_failed,
    'break_saved', v_break_saved,
    -- 保存後の版（この作業員・この日の全現場の行）。画面は次の送信の expected_versions に使う
    'versions', (SELECT COALESCE(jsonb_object_agg(t.id, t.updated_at), '{}'::jsonb)
                   FROM public."TaskRecords" t
                  WHERE t.worker_name = v_worker AND t.date = v_date)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.save_daily_report(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_daily_report(jsonb) TO authenticated;

-- ---------------------------------------------------------
-- 承認（20261107020000 版に「画面で見た値」の引数を追加）。
-- 古い 3 引数版を残すと、3 引数の呼び出しで PostgREST が候補を決められない（PGRST203）ので消す。
-- 足した引数は DEFAULT NULL なので、旧画面の 3 引数の呼び出しはこちらに当たる（比べない）。
-- ---------------------------------------------------------
DROP FUNCTION IF EXISTS public.approve_overtime(bigint, text, bigint);
DROP FUNCTION IF EXISTS public.approve_work_allowance(bigint, text, bigint);

CREATE OR REPLACE FUNCTION public.approve_overtime(
  p_id bigint,
  p_approver_name text,
  p_approver_worker_id bigint,
  p_expected_hours numeric DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public."OvertimeApprovals";
  v_worker_id bigint;
  v_worker text;
  v_approver text;
BEGIN
  -- 承認の間に申請が書き換わらないようロックする
  SELECT * INTO v_row FROM public."OvertimeApprovals" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '残業申請が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_approver_worker_id, p_approver_name) e;
  IF NOT (public.is_office_or_admin()
          OR (COALESCE(public.current_staff_role() = 'worker', false)
              AND public.is_declared_foreman(v_row.project_id, v_worker_id, v_worker))) THEN
    RAISE EXCEPTION '残業を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;
  IF v_row.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'この残業申請は承認待ちではありません。' USING ERRCODE = '22023';
  END IF;
  -- 画面で見た値と違えば承認しない
  IF (p_expected_hours IS NOT NULL AND v_row.requested_hours IS DISTINCT FROM p_expected_hours)
     OR (p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at) THEN
    RAISE EXCEPTION '申請の内容が変わりました（残業 %h）。一覧を読み込み直してから承認してください。', v_row.requested_hours
      USING ERRCODE = 'PT409';
  END IF;
  v_approver := public._approver_name(p_approver_name);

  UPDATE public."OvertimeApprovals"
     SET status = 'approved',
         approved_by = v_approver,
         approved_at = now(),
         approved_hours = requested_hours,
         -- 自分の申請を自分で承認したときは知らせる必要がないので、確認済みにしておく
         acknowledged_at = CASE WHEN btrim(worker_name) = btrim(v_approver) THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_work_allowance(
  p_id bigint,
  p_approver_name text,
  p_approver_worker_id bigint,
  p_expected_task_names text[] DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public."WorkAllowanceApprovals";
  v_worker_id bigint;
  v_worker text;
  v_approver text;
BEGIN
  SELECT * INTO v_row FROM public."WorkAllowanceApprovals" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '作業手当の申請が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_approver_worker_id, p_approver_name) e;
  IF NOT (public.is_office_or_admin()
          OR (COALESCE(public.current_staff_role() = 'worker', false)
              AND public.is_declared_foreman(v_row.project_id, v_worker_id, v_worker))) THEN
    RAISE EXCEPTION '作業手当を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;
  IF v_row.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'この作業手当の申請は承認待ちではありません。' USING ERRCODE = '22023';
  END IF;
  -- 画面で見た値と違えば承認しない（工種の時間が変わった保存も _sync_work_allowance_approval が updated_at を進める）
  IF (p_expected_task_names IS NOT NULL
        AND ARRAY(SELECT n FROM unnest(COALESCE(v_row.task_names, '{}')) n ORDER BY n)
            IS DISTINCT FROM ARRAY(SELECT n FROM unnest(p_expected_task_names) n ORDER BY n))
     OR (p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at) THEN
    RAISE EXCEPTION '申請の内容が変わりました。一覧を読み込み直してから承認してください。' USING ERRCODE = 'PT409';
  END IF;
  v_approver := public._approver_name(p_approver_name);

  UPDATE public."WorkAllowanceApprovals"
     SET status = 'approved',
         approved_by = v_approver,
         approved_at = now(),
         approved_task_names = task_names,
         acknowledged_at = CASE WHEN btrim(worker_name) = btrim(v_approver) THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint, numeric, timestamptz) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_work_allowance(bigint, text, bigint, text[], timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint, numeric, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_work_allowance(bigint, text, bigint, text[], timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
