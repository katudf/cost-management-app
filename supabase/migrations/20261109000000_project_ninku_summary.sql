-- =========================================================
-- 配置表・作業員画面の人工表示（消化人工 / 目標人工）
--
-- 1. 目標人工は管理シート（工種の目標時間）とは別に、現場ごとに配置表で直接入力する。
--    Projects.assignment_target_ninku（0以上の整数。未設定は NULL）に持つ。
--    更新できるのは既存の Projects の RLS どおり管理者・事務だけ。
--
-- 2. get_project_ninku_summary(p_as_of, p_project_ids) が現場ごとの消化人工と目標人工を返す。
--    p_project_ids を渡すとその現場だけを集計する（作業員画面は選んだ1現場、配置表はバーに出す現場）。
--    NULL なら全現場。
--    消化人工は本来、日報（TaskRecords）から求める。日報の運用が始まるまでの仮の算出として、
--    配置表（Assignments）の p_as_of 当日までの配置実績から求める。
--      - 作業員の区分（作業員・管理・事務）に関係なく、現場に配置された人を数える。
--      - 1人が同じ日に複数の現場に配置されているときは、現場数で均等に分ける（2現場なら 0.5 人工ずつ）。
--      - 有給などの予定（projectId が空）は数えない。土日・祝日・休工日でも配置があれば数える。
--    日報ベースに切り替えるときは、この関数の consumed の求め方を差し替える。
--    呼び出し側は src/hooks/useProjectNinku.js の fetchProjectNinkuSummary だけ。
--
--    SECURITY INVOKER とし、呼び出したユーザーの RLS（Assignments / Projects の閲覧権限）に従う。
-- =========================================================

ALTER TABLE public."Projects"
    ADD COLUMN IF NOT EXISTS assignment_target_ninku integer
    CONSTRAINT projects_assignment_target_ninku_nonnegative CHECK (assignment_target_ninku >= 0);

COMMENT ON COLUMN public."Projects".assignment_target_ninku IS
    '配置表の目標人工（現場ごとに配置表で直接入力。管理シートの工種の目標時間とは別管理）';

-- 集計で配置を引くための索引（対象の現場の配置を探す／その作業員・その日の全配置を数える）
CREATE INDEX IF NOT EXISTS assignments_project_date_idx
    ON public."Assignments" ("projectId", date);
CREATE INDEX IF NOT EXISTS assignments_worker_date_idx
    ON public."Assignments" ("workerId", date);

-- 開発中の版（目標を工種の目標時間で返していた・現場の絞り込みなし）と形が違うため、作り直す
DROP FUNCTION IF EXISTS public.get_project_ninku_summary(date);
DROP FUNCTION IF EXISTS public.get_project_ninku_summary(date, bigint[]);

CREATE OR REPLACE FUNCTION public.get_project_ninku_summary(p_as_of date, p_project_ids bigint[] DEFAULT NULL)
RETURNS TABLE (project_id bigint, consumed_ninku numeric, target_ninku integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH target_days AS (
        -- 対象の現場に配置のある「作業員×日」。均等割りの分母は、その日の全現場の配置から数える
        SELECT DISTINCT a."workerId" AS worker_id, a.date
        FROM public."Assignments" a
        WHERE a."projectId" IS NOT NULL
          AND a."workerId" IS NOT NULL
          AND a.date <= p_as_of
          AND (p_project_ids IS NULL OR a."projectId" = ANY (p_project_ids))
    ),
    day_assign AS (
        -- 同じ作業員・同じ日・同じ現場の重複配置は1件として扱う
        SELECT DISTINCT a."workerId" AS worker_id, a.date, a."projectId" AS project_id
        FROM public."Assignments" a
        JOIN target_days t ON t.worker_id = a."workerId" AND t.date = a.date
        WHERE a."projectId" IS NOT NULL
    ),
    consumed AS (
        SELECT s.project_id, sum(s.share) AS ninku
        FROM (
            SELECT d.project_id,
                   1.0 / count(*) OVER (PARTITION BY d.worker_id, d.date) AS share
            FROM day_assign d
        ) s
        WHERE p_project_ids IS NULL OR s.project_id = ANY (p_project_ids)
        GROUP BY s.project_id
    )
    SELECT p.id,
           coalesce(c.ninku, 0)::numeric,
           p.assignment_target_ninku
    FROM public."Projects" p
    LEFT JOIN consumed c ON c.project_id = p.id
    WHERE (p_project_ids IS NULL OR p.id = ANY (p_project_ids))
      AND (c.ninku IS NOT NULL OR p.assignment_target_ninku IS NOT NULL);
$$;

REVOKE EXECUTE ON FUNCTION public.get_project_ninku_summary(date, bigint[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_ninku_summary(date, bigint[]) TO authenticated;
