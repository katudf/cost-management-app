-- 配置表のログイン不要共有（共有キー付きURL）
-- トークンは管理者のみ参照可能な専用テーブルに保持する
-- （system_settings は worker/viewer も SELECT できるため使わない）

CREATE TABLE IF NOT EXISTS public.schedule_share (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    token text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedule_share ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_share_admin_all ON public.schedule_share;
CREATE POLICY schedule_share_admin_all ON public.schedule_share
    FOR ALL TO authenticated
    USING (coalesce(public.is_admin(), false))
    WITH CHECK (coalesce(public.is_admin(), false));

INSERT INTO public.schedule_share (id, token) VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- 共有キーを再発行（旧URLは無効化）。管理者のみ。
CREATE OR REPLACE FUNCTION public.regenerate_schedule_share_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token text;
BEGIN
    IF NOT coalesce(public.is_admin(), false) THEN
        RAISE EXCEPTION 'permission denied';
    END IF;
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    UPDATE public.schedule_share SET token = v_token, updated_at = now() WHERE id = 1;
    RETURN v_token;
END;
$$;

-- 共有を停止（キーを削除）。管理者のみ。
CREATE OR REPLACE FUNCTION public.disable_schedule_share()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT coalesce(public.is_admin(), false) THEN
        RAISE EXCEPTION 'permission denied';
    END IF;
    UPDATE public.schedule_share SET token = NULL, updated_at = now() WHERE id = 1;
END;
$$;

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
        ), '[]'::jsonb)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.regenerate_schedule_share_token() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.disable_schedule_share() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_schedule_share_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_schedule_share() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_public_schedule(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_schedule(text, date, date) TO anon, authenticated;
