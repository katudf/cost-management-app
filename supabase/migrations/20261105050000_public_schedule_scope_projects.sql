-- =========================================================
-- 共有配置表（get_public_schedule）が返す現場を絞り、色の規則を管理画面と揃える
--
-- 【問題】
-- 1. 現場（projects）を期間に関係なく全件返していた。見積・完了も含む全履歴の現場名・工期が、
--    共有 URL を持つ人なら誰でもログインなしで取れた。
-- 2. 「開始日・終了日のある現場」しか返さないため、日付未設定の現場に配置すると、
--    共有表示では現場名が引けず、名前のない灰色のセルになっていた。
-- 3. バーの既定色を画面側で「返ってきた一覧の順番」から決めていたため、
--    管理画面の配置表（予定・施工中の一覧の順番）と色がずれていた。
--
-- 【対処】
-- - 返す現場を「表示期間にかかるバー対象の現場」と「表示期間の配置が参照する現場」に限る。
--   後者は日付が無くても返す（名前を出すため）。
-- - バー対象（予定・施工中、有給用を除く）の現場に、管理画面と同じ並び（表示順 → 作成日時）での
--   位置 bar_index を付けて返す。既定色は画面側で DEFAULT_COLORS[bar_index] を使う
--   （規則は src/utils/scheduleDisplay.js と同じ）。
-- 作業員・配置・会社休日の部分は 20260928014840_add_project_short_name.sql から変えていない。
-- =========================================================

CREATE OR REPLACE FUNCTION public.get_public_schedule(p_key text, p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token text;
BEGIN
    SELECT token INTO v_token FROM public.schedule_share WHERE id = 1;
    IF v_token IS NULL OR p_key IS NULL OR length(p_key) = 0 OR p_key <> v_token THEN
        RAISE EXCEPTION 'invalid share key' USING ERRCODE = '28000';
    END IF;
    IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 62 THEN
        RAISE EXCEPTION 'invalid date range';
    END IF;

    RETURN jsonb_build_object(
        'workers', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'display_order', w.display_order)
                             ORDER BY w.display_order NULLS LAST, w.id)
            FROM public."Workers" w
            WHERE w.name IS NOT NULL AND btrim(w.name) <> ''
              AND w.show_in_assignment IS NOT FALSE
              AND w.resignation_date IS NULL
        ), '[]'::jsonb),
        'assignments', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'workerId', a."workerId", 'date', a.date, 'projectId', a."projectId",
                       'title', a.title, 'assignment_order', a.assignment_order)
                             ORDER BY a.date, a.assignment_order NULLS LAST, a.id)
            FROM public."Assignments" a
            WHERE a.date BETWEEN p_start AND p_end
        ), '[]'::jsonb),
        'projects', coalesce((
            WITH bar AS (
                -- バー対象の現場と、その並び位置（管理画面の配置表と同じ規則）
                SELECT p.id,
                       (row_number() OVER (ORDER BY p.display_order NULLS LAST, p.created_at) - 1) AS bar_index
                FROM public."Projects" p
                WHERE p.status IN ('予定', '施工中')
                  AND coalesce(p.name, '') NOT IN ('【会社】有給', '有給', '【有給】')
            ),
            used AS (
                SELECT DISTINCT a."projectId" AS id
                FROM public."Assignments" a
                WHERE a.date BETWEEN p_start AND p_end AND a."projectId" IS NOT NULL
            )
            SELECT jsonb_agg(jsonb_build_object(
                       'id', p.id, 'name', p.name, 'short_name', p.short_name,
                       'startDate', p."startDate", 'endDate', p."endDate",
                       'bar_color', p.bar_color, 'status', p.status,
                       'display_order', p.display_order, 'bar_index', b.bar_index)
                             ORDER BY p.display_order NULLS LAST, p.created_at)
            FROM public."Projects" p
            LEFT JOIN bar b ON b.id = p.id
            WHERE (b.id IS NOT NULL
                   AND p."startDate" IS NOT NULL AND p."endDate" IS NOT NULL
                   AND p."startDate" <= p_end AND p."endDate" >= p_start)
               OR p.id IN (SELECT id FROM used)
        ), '[]'::jsonb),
        'holidays', coalesce((
            SELECT jsonb_agg(jsonb_build_object('date', h.date, 'description', h.description) ORDER BY h.date)
            FROM public."CompanyHolidays" h
            WHERE h.date BETWEEN p_start AND p_end
        ), '[]'::jsonb)
    );
END;
$$;
