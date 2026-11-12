-- 消化人工の集計から、下請け会社の配置行を除く（docs/specs/subcontractors.md §11.6）
-- 20261109000000 では、下請けの会社行も「1人1日」と数えていた。社員の人工だけを数える。
-- 下請けの人数は、予定は Assignments.planned_count、実績は SubcontractorRecords で別に見る。
-- ninku の関数は SECURITY INVOKER で、Workers の基表は作業員・閲覧者に開いていないため、
-- 下請けかどうかの判定は SECURITY DEFINER の小さな関数に切り出す（行の内容は返さず、真偽だけ）。
CREATE OR REPLACE FUNCTION public.is_subcontractor_worker(p_worker_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public."Workers" w WHERE w.id = p_worker_id AND w.subcontractor_id IS NOT NULL);
$$;

REVOKE EXECUTE ON FUNCTION public.is_subcontractor_worker(bigint) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_subcontractor_worker(bigint) TO authenticated;

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
          AND NOT public.is_subcontractor_worker(a."workerId")
          AND a.date <= p_as_of
          AND (p_project_ids IS NULL OR a."projectId" = ANY (p_project_ids))
    ),
    day_assign AS (
        -- 同じ作業員・同じ日・同じ現場の重複配置は1件として扱う
        SELECT DISTINCT a."workerId" AS worker_id, a.date, a."projectId" AS project_id
        FROM public."Assignments" a
        JOIN target_days t ON t.worker_id = a."workerId" AND t.date = a.date
        WHERE a."projectId" IS NOT NULL
          AND NOT public.is_subcontractor_worker(a."workerId")
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
