-- 下請け会社の正式管理 マイグレーションB（データ移行。20261112000000 のあとに実行する）
-- 設計: docs/specs/subcontractors.md §7・§11.8
--
-- 実行前に実 DB で確認すること（docs/specs/subcontractors.md §11.8）:
--   SELECT company_name, unit_price, count(*) FROM "SubcontractorRecords" GROUP BY 1, 2 ORDER BY 1, 2;
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public."Workers"'::regclass;   -- display_order の UNIQUE の有無
--   下請け 2 社の Workers 行が TaskRecords.worker_name / auth_user_id / lineworks_user_id に使われていないこと
--
-- 内容（何度流しても同じ結果になる）:
--   1. Workers の下請け行（㈲菊池塗装工業所・㈲藤澤塗装）から Subcontractors を作り、その Workers 行に紐づける
--      （Workers 行は増やさず、Assignments は付け替えない）
--   2. SubcontractorRecords を会社名で照合し subcontractor_id を埋める。一致しないものは NULL のまま
--   3. 現場×会社ごとに常用の暫定契約を作る（単価は既存記録の最新の非 0 単価。なければ 0 のまま = 単価未設定）。needs_review = true
--   4. 契約の単価を、単価 0 の既存記録にコピーする
DO $$
DECLARE
  v_names text[] := ARRAY['㈲菊池塗装工業所', '㈲藤澤塗装'];
  v_found integer;
BEGIN
  SELECT count(*) INTO v_found FROM public."Workers" w
   WHERE w.name = ANY (v_names) OR public.normalize_company_name(w.name) = ANY (
     SELECT public.normalize_company_name(n) FROM unnest(v_names) n);
  IF v_found <> array_length(v_names, 1) AND NOT EXISTS (SELECT 1 FROM public."Subcontractors") THEN
    RAISE EXCEPTION '下請けの Workers 行が % 件しか見つかりません（想定 %）。名前を確認してください。',
      v_found, array_length(v_names, 1);
  END IF;
END $$;

-- 1. 会社マスタと Workers 行の紐づけ（Workers 行は作らない）
SELECT set_config('app.skip_subcontractor_worker_create', 'on', false);
INSERT INTO public."Subcontractors" (name, standard_unit_price, show_in_assignment)
SELECT w.name, 0, w.show_in_assignment
  FROM public."Workers" w
 WHERE w.subcontractor_id IS NULL
   AND public.normalize_company_name(w.name) IN (
     SELECT public.normalize_company_name(n) FROM unnest(ARRAY['㈲菊池塗装工業所', '㈲藤澤塗装']) n)
   AND NOT EXISTS (
     SELECT 1 FROM public."Subcontractors" s
      WHERE public.normalize_company_name(s.name) = public.normalize_company_name(w.name));
SELECT set_config('app.skip_subcontractor_worker_create', 'off', false);

SELECT set_config('app.bypass_subcontractor_sync', 'on', false);
UPDATE public."Workers" w
   SET subcontractor_id = s.id
  FROM public."Subcontractors" s
 WHERE w.subcontractor_id IS NULL
   AND public.normalize_company_name(w.name) = public.normalize_company_name(s.name)
   AND NOT EXISTS (SELECT 1 FROM public."Workers" x WHERE x.subcontractor_id = s.id);
SELECT set_config('app.bypass_subcontractor_sync', 'off', false);

-- 2・3. 現場×会社の暫定契約（常用）。単価は既存記録の最新の非 0 単価
INSERT INTO public."SubcontractContracts" (project_id, subcontractor_id, type, unit_price, needs_review)
SELECT r.project_id::bigint,
       s.id,
       '常用',
       COALESCE((SELECT r2.unit_price
                   FROM public."SubcontractorRecords" r2
                  WHERE r2.project_id = r.project_id
                    AND public.normalize_company_name(r2.company_name) = public.normalize_company_name(s.name)
                    AND COALESCE(r2.unit_price, 0) > 0
                  ORDER BY r2.date DESC, r2.created_at DESC
                  LIMIT 1), s.standard_unit_price),
       true
  FROM (SELECT DISTINCT project_id, public.normalize_company_name(company_name) AS norm
          FROM public."SubcontractorRecords") r
  JOIN public."Subcontractors" s ON public.normalize_company_name(s.name) = r.norm
 WHERE EXISTS (SELECT 1 FROM public."Projects" p WHERE p.id = r.project_id::bigint)
ON CONFLICT (project_id, subcontractor_id) WHERE type = '常用' DO NOTHING;

-- 2・4. 記録の照合と単価コピー（BEFORE トリガーが company_name の正規化と単価 0 へのコピーを行う）
UPDATE public."SubcontractorRecords" r
   SET subcontractor_id = s.id
  FROM public."Subcontractors" s
 WHERE r.subcontractor_id IS NULL
   AND public.normalize_company_name(r.company_name) = public.normalize_company_name(s.name)
   AND public.normalize_company_name(r.company_name) <> '';
