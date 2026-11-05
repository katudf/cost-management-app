-- 共有配置表のRPCに会社休日（CompanyHolidays）を追加し、休日列の色分けをメイン配置表と揃える

-- 共有キーで配置表データのみを返す（ログイン不要）
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
            SELECT jsonb_agg(jsonb_build_object(
                       'id', p.id, 'name', p.name, 'startDate', p."startDate",
                       'endDate', p."endDate", 'bar_color', p.bar_color,
                       'status', p.status, 'display_order', p.display_order)
                             ORDER BY p.display_order NULLS LAST, p.created_at)
            FROM public."Projects" p
            WHERE p."startDate" IS NOT NULL AND p."endDate" IS NOT NULL
        ), '[]'::jsonb),
        'holidays', coalesce((
            SELECT jsonb_agg(jsonb_build_object('date', h.date, 'description', h.description) ORDER BY h.date)
            FROM public."CompanyHolidays" h
            WHERE h.date BETWEEN p_start AND p_end
        ), '[]'::jsonb)
    );
END;
$$;
