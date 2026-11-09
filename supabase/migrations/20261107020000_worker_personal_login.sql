-- =========================================================
-- 作業員の個人ログイン（フェーズA: 共有アカウントとの併用）  設計: docs/specs/worker-login.md
--
-- 作業員ごとに独自ログインIDの Auth ユーザーを発行し、Workers.auth_user_id で紐付ける。
-- ID発行・リセット・ID変更・削除・BAN は Edge Function manage-staff-login（target: 'worker'）が
-- service_role で行い、DB 側の更新と権限の再確認はここで作る service_role 専用 RPC で行う。
--
-- 1. Workers.auth_user_id と保護トリガー（紐付けの変更・紐付き行の削除は service_role の RPC だけ）
-- 2. ロール判定: current_worker_id() / is_personal_worker() を新設し、current_staff_role() を作業員に広げる。
--    is_staff() は変えない（印影バケットを作業員に開かないため）。名簿ビューだけ作業員にも開く
-- 3. 本人用・一覧用の RPC（get_my_worker / get_worker_login_ids）
-- 4. 作業員IDや名前を引数で受け取る日報・承認の RPC を、作業員アカウントではサーバー側で本人に固定する
-- 5. パスワード変更履歴の作業員対応
-- 6. Edge Function 専用 RPC
-- =========================================================

-- ---------- 1. 紐付け列と保護トリガー ----------
ALTER TABLE public."Workers" ADD COLUMN IF NOT EXISTS auth_user_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workers_auth_user_id_key') THEN
    ALTER TABLE public."Workers" ADD CONSTRAINT workers_auth_user_id_key UNIQUE (auth_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workers_auth_user_id_fkey') THEN
    ALTER TABLE public."Workers" ADD CONSTRAINT workers_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 管理者を含め、画面（authenticated）からは紐付けを変えられない。紐付き行の直接 DELETE もできない
-- （Edge Function の delete を経由させ、Auth ユーザーの取り残しを防ぐ）。
-- 注意: 紐付いたままの Auth ユーザーを消すと ON DELETE SET NULL の更新がここで止まる。
-- 先に RPC で紐付けを外す（office_staff の保護トリガーと同じ扱い。docs/specs/login-id.md の削除手順）。
CREATE OR REPLACE FUNCTION public.protect_workers_auth_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.bypass_worker_protect_trigger', true), 'off') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION '作業員のログインは作業員マスタの「ID発行」から設定してください。';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'ログインIDのある作業員は、作業員マスタの削除ボタンから削除してください。';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION '作業員のログインの紐付けは、作業員マスタのログイン操作からだけ変更できます。';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_workers_auth_user_id() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_protect_workers_auth_user_id ON public."Workers";
CREATE TRIGGER trg_protect_workers_auth_user_id
  BEFORE INSERT OR UPDATE OR DELETE ON public."Workers"
  FOR EACH ROW EXECUTE FUNCTION public.protect_workers_auth_user_id();

-- ---------- 2. ロール判定 ----------
-- 退職済みか（退職日が日本時間の今日以前）。DB の current_date は UTC のため日本時間で比べる。
CREATE OR REPLACE FUNCTION public.is_resigned(p_resignation_date text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(btrim(p_resignation_date), '') IS NOT NULL
     AND NULLIF(btrim(p_resignation_date), '')::date <= (now() AT TIME ZONE 'Asia/Tokyo')::date;
$$;

-- ログイン中の Auth ユーザーに紐付いた、退職していない作業員の id（担当者兼作業員でも返す）
CREATE OR REPLACE FUNCTION public.current_worker_id()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id FROM "Workers" w
   WHERE auth.uid() IS NOT NULL
     AND w.auth_user_id = auth.uid()
     AND NOT public.is_resigned(w.resignation_date::text);
$$;

-- 作業員の個人アカウントか（担当者の行が無く、作業員に紐付いている）。
-- 「作業員アカウントとして本人に固定する」判定はすべてこれで行う。
-- current_staff_role() = 'worker' は共有アカウントでも真、current_worker_id() は担当者兼作業員でも真になるため。
CREATE OR REPLACE FUNCTION public.is_personal_worker()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM office_staff WHERE auth_user_id = auth.uid())
     AND public.current_worker_id() IS NOT NULL;
$$;

-- 担当者の role を優先し、担当者の行が無ければ作業員の個人アカウントを 'worker' とする。
-- RLS のポリシーはこの関数で判定しているので、ポリシーは書き換えずに作業員アカウントへ広がる。
--
-- ロールが無いとき（退職した作業員・どこにも紐付かないログイン・未ログイン）は NULL ではなく 'none' を返す。
-- NULL だと「IF NOT (... OR current_staff_role() = 'worker')」が NULL になり、権限エラーを素通りする
-- （見積 RPC で 20260910054306 が塞いだのと同じ問題）。使っている側はすべて = / IN の比較なので、
-- 'none' はどのロールにも一致せず、従来の NULL と同じく「権限なし」になる。
--
-- ポリシーからは行ごとに呼ばれるので、作業員の判定は関数を重ねずにこの中で直接引く
-- （担当者の行があれば COALESCE で作業員の問い合わせは行わない）。
CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM office_staff WHERE auth_user_id = auth.uid() LIMIT 1),
    (SELECT 'worker'::text FROM "Workers" w
      WHERE w.auth_user_id = auth.uid() AND NOT public.is_resigned(w.resignation_date::text) LIMIT 1),
    'none'
  );
$$;

-- 担当者（事務以上）か。NULL を返さないようにする（current_staff_role() が 'none' を返すようになったので
-- 本来は NULL にならないが、ロール判定の関数が将来変わっても素通りしないよう二重に守る。
-- 日報・承認の RPC の作業員判定も、同じ理由で COALESCE(... , false) にしている）。
CREATE OR REPLACE FUNCTION public.is_office_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.is_admin() OR public.current_staff_role() = 'office', false);
$function$;

REVOKE EXECUTE ON FUNCTION public.is_office_or_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_office_or_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.current_worker_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_personal_worker() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_staff_role() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_worker_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_personal_worker() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO authenticated;

-- 作業員名簿: 作業員の個人アカウントにも開く（is_staff() は担当者の行しか見ない）
CREATE OR REPLACE VIEW public.workers_directory AS
  SELECT id, name, display_order, worker_type, resignation_date, show_in_assignment
  FROM public."Workers"
  WHERE is_staff() OR public.is_personal_worker();

-- ---------- 3. 本人用・一覧用 ----------
-- 自分の作業員（担当者兼作業員も含む）。Workers 基表は作業員に SELECT を許していないのでこれを使う。
CREATE OR REPLACE FUNCTION public.get_my_worker()
RETURNS TABLE (id bigint, name text, worker_type text, display_order integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.name::text, w.worker_type::text, w.display_order::integer
    FROM "Workers" w
   WHERE w.id = public.current_worker_id();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_worker() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_worker() TO authenticated;

-- 作業員マスタの一覧用。管理者以外は0件。
--   login_id        : ログインID（架空メールでなければ NULL）
--   linked_staff_id : 担当者と共有のアカウントなら、その担当者の id
--   banned          : ログイン停止中か
CREATE OR REPLACE FUNCTION public.get_worker_login_ids()
RETURNS TABLE (worker_id bigint, login_id text, linked_staff_id bigint, banned boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id,
         public.login_id_from_email(u.email),
         s.id,
         COALESCE(u.banned_until > now(), false)
    FROM "Workers" w
    JOIN auth.users u ON u.id = w.auth_user_id
    LEFT JOIN office_staff s ON s.auth_user_id = w.auth_user_id
   WHERE is_admin();
$$;

REVOKE EXECUTE ON FUNCTION public.get_worker_login_ids() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_worker_login_ids() TO authenticated;

-- ---------- 4. 日報・承認の RPC ----------
-- 引数で申告された作業員を、作業員の個人アカウントのときはログイン中の本人に置き換える。
-- 担当者（代理入力）と共有アカウント（移行期間）は申告どおり。
CREATE OR REPLACE FUNCTION public._effective_worker(
  p_worker_id bigint, p_worker_name text, OUT worker_id bigint, OUT worker_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_personal_worker() THEN
    SELECT w.id, NULLIF(btrim(w.name), '') INTO worker_id, worker_name
      FROM "Workers" w WHERE w.id = public.current_worker_id();
  ELSE
    worker_id := p_worker_id;
    worker_name := NULLIF(btrim(p_worker_name), '');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._effective_worker(bigint, text) FROM anon, PUBLIC, authenticated;

-- 承認者として記録する名前。担当者は自分の名前（代理で承認しても作業員の名前で残さない。担当者兼作業員は作業員名）、
-- 作業員アカウントは本人の名前、共有アカウントは申告された名前。
CREATE OR REPLACE FUNCTION public._approver_name(p_declared_name text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_office_or_admin() THEN
      -- 担当者兼作業員は作業員としての名前で残す（職長として自分の申請を承認したときに「本人の承認」と判定できるように）
      COALESCE((SELECT NULLIF(btrim(w.name), '') FROM "Workers" w WHERE w.id = public.current_worker_id()),
               (SELECT NULLIF(btrim(name), '') FROM office_staff WHERE auth_user_id = auth.uid() LIMIT 1),
               NULLIF(btrim(p_declared_name), ''))
    ELSE (SELECT e.worker_name FROM public._effective_worker(NULL, p_declared_name) e)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public._approver_name(text) FROM anon, PUBLIC, authenticated;

-- 日報の保存（20261105040000 版から、作業員の決め方だけを変更）
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
  v_row jsonb;
  v_data jsonb;
  v_count integer;
  v_new_id bigint;
  v_ot_project bigint;
  v_approval_failed boolean := false;
BEGIN
  IF NOT (v_privileged OR COALESCE(public.current_staff_role() = 'worker', false)) THEN
    RAISE EXCEPTION '日報を保存する権限がありません。' USING ERRCODE = '42501';
  END IF;
  -- 作業員アカウントは送られた作業員名・ID を使わず本人にする
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(NULLIF(p_payload->>'worker_id', '')::bigint, p_payload->>'worker_name') e;
  IF v_worker IS NULL OR v_project IS NULL OR v_date IS NULL THEN
    RAISE EXCEPTION '日報の保存内容が不正です。' USING ERRCODE = '22023';
  END IF;
  -- 職長判定: 作業員名と worker_id が同じ人で、その人がこの現場の職長であること
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
    'approval_sync_failed', v_approval_failed
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.save_daily_report(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_daily_report(jsonb) TO authenticated;

-- 作業員・現場・日付単位の日報削除（20261105020000 版から、作業員の決め方だけを変更）
CREATE OR REPLACE FUNCTION public.delete_worker_project_day(
  p_project_id bigint, p_worker_name text, p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker text;
BEGIN
  IF NOT (public.is_office_or_admin() OR COALESCE(public.current_staff_role() = 'worker', false)) THEN
    RAISE EXCEPTION '日報を削除する権限がありません。' USING ERRCODE = '42501';
  END IF;
  SELECT e.worker_name INTO v_worker FROM public._effective_worker(NULL, p_worker_name) e;
  IF v_worker IS NULL OR p_project_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION '削除する日報の指定が不正です。' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."TaskRecords"
   WHERE project_id = p_project_id AND worker_name = v_worker AND date = p_date;
  DELETE FROM public."OvertimeApprovals"
   WHERE project_id = p_project_id AND worker_name = v_worker AND date = p_date;
  DELETE FROM public."WorkAllowanceApprovals"
   WHERE project_id = p_project_id AND worker_name = v_worker AND date = p_date;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_worker_project_day(bigint, text, date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_worker_project_day(bigint, text, date) TO authenticated;

-- 作業項目の追加（20261105020000 版から、作業員の決め方だけを変更）
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
  v_worker_id bigint;
  v_worker text;
BEGIN
  SELECT foreman_worker_id IS NOT NULL INTO v_has_foreman FROM public."Projects" WHERE id = p_project_id;
  IF v_has_foreman IS NULL THEN
    RAISE EXCEPTION '現場が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_worker_id, p_worker_name) e;
  IF NOT (public.is_office_or_admin()
          OR (COALESCE(public.current_staff_role() = 'worker', false)
              AND (NOT v_has_foreman OR public.is_declared_foreman(p_project_id, v_worker_id, v_worker)))) THEN
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

-- 承認（20261105030000 版から、職長の決め方と承認者名の記録だけを変更）。
-- 引数は共有アカウント廃止後も残す（古い画面のキャッシュが壊れないように。設計 §3.2）。
CREATE OR REPLACE FUNCTION public.approve_overtime(p_id bigint, p_approver_name text, p_approver_worker_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project bigint;
  v_worker_id bigint;
  v_worker text;
  v_approver text;
BEGIN
  SELECT project_id INTO v_project FROM public."OvertimeApprovals" WHERE id = p_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION '残業申請が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_approver_worker_id, p_approver_name) e;
  IF NOT (public.is_office_or_admin()
          OR (COALESCE(public.current_staff_role() = 'worker', false)
              AND public.is_declared_foreman(v_project, v_worker_id, v_worker))) THEN
    RAISE EXCEPTION '残業を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
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
  v_worker_id bigint;
  v_worker text;
  v_approver text;
BEGIN
  SELECT project_id INTO v_project FROM public."WorkAllowanceApprovals" WHERE id = p_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION '作業手当の申請が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_approver_worker_id, p_approver_name) e;
  IF NOT (public.is_office_or_admin()
          OR (COALESCE(public.current_staff_role() = 'worker', false)
              AND public.is_declared_foreman(v_project, v_worker_id, v_worker))) THEN
    RAISE EXCEPTION '作業手当を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;
  v_approver := public._approver_name(p_approver_name);

  UPDATE public."WorkAllowanceApprovals"
     SET status = 'approved',
         approved_by = v_approver,
         approved_at = now(),
         approved_task_names = task_names,
         acknowledged_at = CASE WHEN btrim(worker_name) = btrim(v_approver) THEN now() ELSE NULL END,
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

-- 承認のお知らせの確認（20261105030000 版から、作業員の決め方だけを変更）
CREATE OR REPLACE FUNCTION public.acknowledge_approvals(
  p_worker_name text, p_worker_id bigint, p_overtime_ids bigint[], p_allowance_ids bigint[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker text;
  v_worker_id bigint;
BEGIN
  IF NOT (public.is_office_or_admin() OR COALESCE(public.current_staff_role() = 'worker', false)) THEN
    RAISE EXCEPTION 'お知らせを確認する権限がありません。' USING ERRCODE = '42501';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_worker_id, p_worker_name) e;
  IF v_worker IS NULL OR NOT public.is_declared_worker(v_worker_id, v_worker) THEN
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

-- ---------- 5. パスワード変更履歴 ----------
-- staff_name には担当者名、担当者でなければ作業員名を入れる（画面の「氏名」欄）
ALTER TABLE password_change_logs ADD COLUMN IF NOT EXISTS worker_id bigint;

-- 本人による変更の記録（20261107000000 版に、作業員アカウントの記録を追加）
CREATE OR REPLACE FUNCTION public.log_password_change(p_kind text DEFAULT 'recovery')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := COALESCE(NULLIF(p_kind, ''), 'recovery');
  v_headers json;
  v_staff office_staff%ROWTYPE;
  v_worker_id bigint;
  v_worker_name text;
  v_email text;
  v_user_updated_at timestamptz;
  v_fingerprint text;
  v_prev_fingerprint text;
  v_xff text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_kind NOT IN ('recovery', 'self') THEN
    RAISE EXCEPTION 'invalid password change kind: %', v_kind;
  END IF;

  SELECT email,
         updated_at,
         encode(sha256(convert_to(COALESCE(encrypted_password, ''), 'UTF8')), 'hex')
    INTO v_email, v_user_updated_at, v_fingerprint
  FROM auth.users WHERE id = v_uid;

  SELECT password_fingerprint INTO v_prev_fingerprint
  FROM password_change_log_state WHERE auth_user_id = v_uid;

  IF FOUND THEN
    -- パスワードが前回記録時から変わっていなければ記録しない
    IF v_prev_fingerprint = v_fingerprint THEN
      RETURN;
    END IF;
  ELSIF v_user_updated_at IS NULL OR v_user_updated_at < now() - interval '10 minutes' THEN
    RETURN;
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  v_xff := NULLIF(trim(COALESCE(v_headers ->> 'x-forwarded-for', '')), '');

  SELECT * INTO v_staff FROM office_staff WHERE auth_user_id = v_uid LIMIT 1;
  SELECT id, name INTO v_worker_id, v_worker_name FROM "Workers" WHERE auth_user_id = v_uid LIMIT 1;

  INSERT INTO password_change_logs
    (auth_user_id, staff_id, staff_name, worker_id, email, login_id, kind, user_agent, ip_address, forwarded_for)
  VALUES (
    v_uid,
    v_staff.id,
    COALESCE(v_staff.name, v_worker_name),
    v_worker_id,
    v_email,
    public.login_id_from_email(v_email),
    v_kind,
    v_headers ->> 'user-agent',
    COALESCE(
      NULLIF(trim(COALESCE(v_headers ->> 'cf-connecting-ip', '')), ''),
      NULLIF(trim(split_part(COALESCE(v_xff, ''), ',', 1)), '')
    ),
    v_xff
  );

  INSERT INTO password_change_log_state (auth_user_id, password_fingerprint, updated_at)
  VALUES (v_uid, v_fingerprint, now())
  ON CONFLICT (auth_user_id) DO UPDATE
    SET password_fingerprint = EXCLUDED.password_fingerprint,
        updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.log_password_change(text) FROM public;
GRANT EXECUTE ON FUNCTION public.log_password_change(text) TO authenticated;

-- ---------- 6. Edge Function 専用 RPC ----------
-- 呼び出し元が対象の作業員のログインを操作できるかを確かめ、対象の行を返す。
-- 管理者（admin / system_admin）だけ。担当者と共有のアカウントは担当者の権限ルールにも従う
-- （admin / system_admin の担当者と共有なら system_admin だけ。login-id.md 決定 #5）。
CREATE OR REPLACE FUNCTION public.assert_can_manage_worker_login(p_caller uuid, p_worker_id bigint, p_lock boolean DEFAULT false)
RETURNS "Workers"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target "Workers"%ROWTYPE;
  v_linked_role text;
BEGIN
  SELECT role INTO v_caller_role FROM office_staff WHERE auth_user_id = p_caller;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'system_admin') THEN
    RAISE EXCEPTION 'この操作には管理者権限が必要です。' USING ERRCODE = '42501';
  END IF;

  IF p_lock THEN
    SELECT * INTO v_target FROM "Workers" WHERE id = p_worker_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM "Workers" WHERE id = p_worker_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の作業員が見つかりません。' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.auth_user_id IS NOT NULL THEN
    SELECT role INTO v_linked_role FROM office_staff WHERE auth_user_id = v_target.auth_user_id;
    IF v_linked_role IN ('admin', 'system_admin') AND v_caller_role <> 'system_admin' THEN
      RAISE EXCEPTION '管理者・システム管理者と共有のログインは、システム管理者だけが操作できます。' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_target;
END;
$$;

-- その Auth ユーザーが担当者の行にも紐付いていれば、その担当者の id
CREATE OR REPLACE FUNCTION public.staff_id_for_auth_user(p_auth_user_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM office_staff WHERE auth_user_id = p_auth_user_id LIMIT 1;
$$;

-- その Auth ユーザーが作業員の行にも紐付いていれば、その作業員の id
CREATE OR REPLACE FUNCTION public.worker_id_for_auth_user(p_auth_user_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM "Workers" WHERE auth_user_id = p_auth_user_id LIMIT 1;
$$;

-- ID発行（create）で作った Auth ユーザーを作業員に紐付ける。権限を行ロック付きで確かめ直す。
CREATE OR REPLACE FUNCTION public.link_worker_login(p_caller uuid, p_worker_id bigint, p_auth_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
BEGIN
  v_target := public.assert_can_manage_worker_login(p_caller, p_worker_id, true);
  IF v_target.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'この作業員には既にログインがあります。' USING ERRCODE = '23505';
  END IF;

  PERFORM set_config('app.bypass_worker_protect_trigger', 'on', true);
  UPDATE "Workers" SET auth_user_id = p_auth_user_id WHERE id = p_worker_id;
  PERFORM set_config('app.bypass_worker_protect_trigger', 'off', true);

  PERFORM public.sync_password_fingerprint(p_auth_user_id);
END;
$$;

-- 担当者のログインを作業員にも紐付ける（担当者兼作業員。設計 決定 #7）。
-- 共有アカウント（worker / viewer）を紐付けると、その全利用者がこの作業員になれてしまうので、
-- office / admin / system_admin でログインIDのある担当者に限る。
CREATE OR REPLACE FUNCTION public.link_worker_to_staff_login(p_caller uuid, p_worker_id bigint, p_staff_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
  v_caller_role text;
  v_staff office_staff%ROWTYPE;
  v_email text;
BEGIN
  v_target := public.assert_can_manage_worker_login(p_caller, p_worker_id, true);
  IF v_target.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'この作業員には既にログインがあります。' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_staff FROM office_staff WHERE id = p_staff_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の担当者が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  IF v_staff.role IS NULL OR v_staff.role NOT IN ('office', 'admin', 'system_admin') THEN
    RAISE EXCEPTION '共有アカウント・閲覧用アカウントは作業員に紐付けられません。' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_caller_role FROM office_staff WHERE auth_user_id = p_caller;
  IF v_staff.role IN ('admin', 'system_admin') AND v_caller_role <> 'system_admin' THEN
    RAISE EXCEPTION '管理者・システム管理者のログインは、システム管理者だけが紐付けられます。' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_staff.auth_user_id;
  IF v_staff.auth_user_id IS NULL OR public.login_id_from_email(v_email) IS NULL THEN
    RAISE EXCEPTION 'この担当者にはまだログインIDがありません。' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM "Workers" WHERE auth_user_id = v_staff.auth_user_id) THEN
    RAISE EXCEPTION 'この担当者のログインは、既に別の作業員に紐付いています。' USING ERRCODE = '23505';
  END IF;

  PERFORM set_config('app.bypass_worker_protect_trigger', 'on', true);
  UPDATE "Workers" SET auth_user_id = v_staff.auth_user_id WHERE id = p_worker_id;
  PERFORM set_config('app.bypass_worker_protect_trigger', 'off', true);
END;
$$;

-- 作業員の紐付けを外し、外した Auth ユーザーの ID を返す（担当者と共有でなければ Edge Function が Auth ユーザーを消す）
CREATE OR REPLACE FUNCTION public.unlink_worker_login(p_caller uuid, p_worker_id bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
BEGIN
  v_target := public.assert_can_manage_worker_login(p_caller, p_worker_id, true);
  IF v_target.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'この作業員にはログインがありません。' USING ERRCODE = '22023';
  END IF;
  IF v_target.auth_user_id = p_caller THEN
    RAISE EXCEPTION '自分自身のログインは外せません。' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.bypass_worker_protect_trigger', 'on', true);
  UPDATE "Workers" SET auth_user_id = NULL WHERE id = p_worker_id;
  PERFORM set_config('app.bypass_worker_protect_trigger', 'off', true);

  RETURN v_target.auth_user_id;
END;
$$;

-- 作業員を削除できるかを確かめ、対象の行を返す。作業員マスタの削除は事務もできる（Workers の RLS と同じ）ので
-- 事務以上に許す。ただし管理者・システム管理者と共有のログインがある作業員は、システム管理者だけ
-- （その人のログインに関わるため。担当者側のログインは消さず、紐付けだけが外れる）。
CREATE OR REPLACE FUNCTION public.assert_can_delete_worker(p_caller uuid, p_worker_id bigint, p_lock boolean DEFAULT false)
RETURNS "Workers"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target "Workers"%ROWTYPE;
  v_linked_role text;
BEGIN
  SELECT role INTO v_caller_role FROM office_staff WHERE auth_user_id = p_caller;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'system_admin', 'office') THEN
    RAISE EXCEPTION '作業員の削除には事務以上の権限が必要です。' USING ERRCODE = '42501';
  END IF;

  IF p_lock THEN
    SELECT * INTO v_target FROM "Workers" WHERE id = p_worker_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM "Workers" WHERE id = p_worker_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の作業員が見つかりません。' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.auth_user_id IS NOT NULL THEN
    SELECT role INTO v_linked_role FROM office_staff WHERE auth_user_id = v_target.auth_user_id;
    IF v_linked_role IN ('admin', 'system_admin') AND v_caller_role <> 'system_admin' THEN
      RAISE EXCEPTION '管理者・システム管理者と共有のログインがある作業員は、システム管理者だけが削除できます。' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_target;
END;
$$;

-- 作業員の行を削除し、紐付いていた Auth ユーザーの ID を返す
CREATE OR REPLACE FUNCTION public.delete_worker_with_login(p_caller uuid, p_worker_id bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
BEGIN
  v_target := public.assert_can_delete_worker(p_caller, p_worker_id, true);
  IF v_target.auth_user_id = p_caller THEN
    RAISE EXCEPTION '自分自身は削除できません。' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.bypass_worker_protect_trigger', 'on', true);
  DELETE FROM "Workers" WHERE id = p_worker_id;
  PERFORM set_config('app.bypass_worker_protect_trigger', 'off', true);

  RETURN v_target.auth_user_id;
END;
$$;

-- 管理者による作業員のパスワード設定を履歴に残し、指紋をそろえる
CREATE OR REPLACE FUNCTION public.log_admin_worker_password_reset(
  p_caller uuid,
  p_worker_id bigint,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_forwarded_for text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
  v_operator office_staff%ROWTYPE;
  v_staff_id bigint;
  v_email text;
BEGIN
  v_target := public.assert_can_manage_worker_login(p_caller, p_worker_id, false);
  SELECT * INTO v_operator FROM office_staff WHERE auth_user_id = p_caller LIMIT 1;
  SELECT email INTO v_email FROM auth.users WHERE id = v_target.auth_user_id;
  v_staff_id := public.staff_id_for_auth_user(v_target.auth_user_id);

  INSERT INTO password_change_logs
    (auth_user_id, staff_id, staff_name, worker_id, email, login_id, kind,
     operator_staff_id, operator_staff_name, user_agent, ip_address, forwarded_for)
  VALUES (
    v_target.auth_user_id, v_staff_id, v_target.name, v_target.id, v_email, public.login_id_from_email(v_email), 'admin_reset',
    v_operator.id, v_operator.name, p_user_agent, p_ip_address, p_forwarded_for
  );

  PERFORM public.sync_password_fingerprint(v_target.auth_user_id);
END;
$$;

-- 退職日に合わせて BAN するかを決める（sync_ban）。退職日は事務も保存できるので、事務以上が呼べる。
-- BAN するかどうかは呼び出し元から受け取らず、DB の退職日だけで決める（設計 §5）。
--   auth_user_id : 紐付いた Auth ユーザー（無ければ NULL＝何もしない）
--   should_ban   : 退職日が入っていれば true（未来の日付でも。決定 #8）
--   shared       : 担当者と共有のアカウント（BAN しない）
CREATE OR REPLACE FUNCTION public.worker_ban_state(p_caller uuid, p_worker_id bigint)
RETURNS TABLE (auth_user_id uuid, should_ban boolean, shared boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_caller_role text;
  v_target "Workers"%ROWTYPE;
BEGIN
  SELECT role INTO v_caller_role FROM office_staff WHERE auth_user_id = p_caller;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'system_admin', 'office') THEN
    RAISE EXCEPTION 'この操作には事務以上の権限が必要です。' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_target FROM "Workers" WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の作業員が見つかりません。' USING ERRCODE = 'P0002';
  END IF;

  auth_user_id := v_target.auth_user_id;
  should_ban := NULLIF(btrim(v_target.resignation_date::text), '') IS NOT NULL;
  shared := v_target.auth_user_id IS NOT NULL AND public.staff_id_for_auth_user(v_target.auth_user_id) IS NOT NULL;
  RETURN NEXT;
END;
$$;

-- Edge Function（service_role）専用。ブラウザからは呼べない。
REVOKE EXECUTE ON FUNCTION public.assert_can_manage_worker_login(uuid, bigint, boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.staff_id_for_auth_user(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.worker_id_for_auth_user(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_worker_login(uuid, bigint, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_worker_to_staff_login(uuid, bigint, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlink_worker_login(uuid, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_worker_with_login(uuid, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_can_delete_worker(uuid, bigint, boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_admin_worker_password_reset(uuid, bigint, text, text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.worker_ban_state(uuid, bigint) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_can_manage_worker_login(uuid, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_id_for_auth_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_id_for_auth_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_worker_login(uuid, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_worker_to_staff_login(uuid, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlink_worker_login(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_worker_with_login(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_can_delete_worker(uuid, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_admin_worker_password_reset(uuid, bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_ban_state(uuid, bigint) TO service_role;
