-- =========================================================
-- 作業員のログインを担当者のログインに統合する  設計: docs/specs/worker-login.md §5.2
--
-- 同じ人が作業員のログインIDと担当者のログインIDを両方持っているとき、担当者のIDを残して1つにまとめる。
-- Edge Function manage-staff-login（target: 'worker', action: 'merge_into_staff'）が
--   1. assert_can_merge_worker_into_staff で統合できるかを確かめる（駄目なら何も変えない）
--   2. 作業員の Auth ユーザーを BAN する
--   3. merge_worker_login_into_staff で Workers.auth_user_id を担当者のものに付け替える（1トランザクション）
--   4. 作業員の古い Auth ユーザーを削除する
-- の順に呼ぶ。担当者側（office_staff）は変えない。
--
-- 担当者側の条件は link_worker_to_staff_login と同じなので、_assert_staff_linkable に切り出して両方から使う
-- （link_worker_to_staff_login の動きは変えない）。
-- =========================================================

-- 作業員に紐付けてよい担当者かを確かめ、その行を返す。
-- 共有アカウント（worker / viewer）を紐付けると、その全利用者がこの作業員になれてしまうので、
-- office / admin / system_admin でログインIDのある担当者に限る。admin / system_admin のログインはシステム管理者だけ。
CREATE OR REPLACE FUNCTION public._assert_staff_linkable(p_caller uuid, p_staff_id bigint, p_lock boolean DEFAULT false)
RETURNS office_staff
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_staff office_staff%ROWTYPE;
  v_email text;
BEGIN
  IF p_lock THEN
    SELECT * INTO v_staff FROM office_staff WHERE id = p_staff_id FOR UPDATE;
  ELSE
    SELECT * INTO v_staff FROM office_staff WHERE id = p_staff_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の担当者が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  IF v_staff.role IS NULL OR v_staff.role NOT IN ('office', 'admin', 'system_admin') THEN
    RAISE EXCEPTION '共有アカウント・閲覧用アカウントは作業員に紐付けられません。' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_caller_role FROM office_staff WHERE auth_user_id = p_caller;
  IF v_staff.role IN ('admin', 'system_admin') AND v_caller_role IS DISTINCT FROM 'system_admin' THEN
    RAISE EXCEPTION '管理者・システム管理者のログインは、システム管理者だけが紐付けられます。' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_staff.auth_user_id;
  IF v_staff.auth_user_id IS NULL OR public.login_id_from_email(v_email) IS NULL THEN
    RAISE EXCEPTION 'この担当者にはまだログインIDがありません。' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM "Workers" WHERE auth_user_id = v_staff.auth_user_id) THEN
    RAISE EXCEPTION 'この担当者のログインは、既に別の作業員に紐付いています。' USING ERRCODE = '23505';
  END IF;
  RETURN v_staff;
END;
$$;

-- 担当者のログインを作業員にも紐付ける（担当者兼作業員。設計 決定 #7）。動きは 20261107020000 と同じ。
CREATE OR REPLACE FUNCTION public.link_worker_to_staff_login(p_caller uuid, p_worker_id bigint, p_staff_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
  v_staff office_staff%ROWTYPE;
BEGIN
  v_target := public.assert_can_manage_worker_login(p_caller, p_worker_id, true);
  IF v_target.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'この作業員には既にログインがあります。' USING ERRCODE = '23505';
  END IF;

  v_staff := public._assert_staff_linkable(p_caller, p_staff_id, true);

  PERFORM set_config('app.bypass_worker_protect_trigger', 'on', true);
  UPDATE "Workers" SET auth_user_id = v_staff.auth_user_id WHERE id = p_worker_id;
  PERFORM set_config('app.bypass_worker_protect_trigger', 'off', true);
END;
$$;

-- 作業員側の統合の条件を確かめ、作業員の行を返す。
-- 管理者権限（assert_can_manage_worker_login）・自分のログインがある・担当者と共有でない・退職日が無い。
-- 退職日は未来の日付でも断る（退職日を入れた時点でログインは止める。決定 #8）。
CREATE OR REPLACE FUNCTION public._assert_worker_mergeable(p_caller uuid, p_worker_id bigint, p_lock boolean DEFAULT false)
RETURNS "Workers"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
BEGIN
  v_target := public.assert_can_manage_worker_login(p_caller, p_worker_id, p_lock);
  IF v_target.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'この作業員にはログインがありません。「担当者のIDを紐付ける」を使ってください。' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM office_staff WHERE auth_user_id = v_target.auth_user_id) THEN
    RAISE EXCEPTION 'この作業員のログインは、既に担当者と共有しています。' USING ERRCODE = '23505';
  END IF;
  IF NULLIF(btrim(v_target.resignation_date::text), '') IS NOT NULL THEN
    RAISE EXCEPTION '退職日のある作業員は統合できません。' USING ERRCODE = '22023';
  END IF;
  RETURN v_target;
END;
$$;

-- 作業員の自分のログインを、担当者のログインに統合できるかを確かめ、作業員の行を返す（Edge Function が BAN の前に呼ぶ）
CREATE OR REPLACE FUNCTION public.assert_can_merge_worker_into_staff(
  p_caller uuid, p_worker_id bigint, p_staff_id bigint, p_lock boolean DEFAULT false
)
RETURNS "Workers"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
BEGIN
  v_target := public._assert_worker_mergeable(p_caller, p_worker_id, p_lock);
  PERFORM public._assert_staff_linkable(p_caller, p_staff_id, p_lock);
  RETURN v_target;
END;
$$;

-- 作業員のログインを担当者のログインに付け替え、外した（古い）Auth ユーザーの ID を返す。
-- 条件は行ロック付きで確かめ直す。p_expected_auth_user_id は Edge Function が BAN したユーザー。
-- 確認から付け替えまでの間に紐付けが変わっていたら、別のユーザーを消さないように断る。
CREATE OR REPLACE FUNCTION public.merge_worker_login_into_staff(
  p_caller uuid, p_worker_id bigint, p_staff_id bigint, p_expected_auth_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target "Workers"%ROWTYPE;
  v_staff office_staff%ROWTYPE;
BEGIN
  v_target := public._assert_worker_mergeable(p_caller, p_worker_id, true);
  v_staff := public._assert_staff_linkable(p_caller, p_staff_id, true);
  IF v_target.auth_user_id IS DISTINCT FROM p_expected_auth_user_id THEN
    RAISE EXCEPTION '操作中にこの作業員のログインが変わりました。画面を開き直してください。' USING ERRCODE = '23505';
  END IF;

  PERFORM set_config('app.bypass_worker_protect_trigger', 'on', true);
  UPDATE "Workers" SET auth_user_id = v_staff.auth_user_id WHERE id = p_worker_id;
  PERFORM set_config('app.bypass_worker_protect_trigger', 'off', true);

  RETURN v_target.auth_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._assert_staff_linkable(uuid, bigint, boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public._assert_worker_mergeable(uuid, bigint, boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_worker_to_staff_login(uuid, bigint, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_can_merge_worker_into_staff(uuid, bigint, bigint, boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_worker_login_into_staff(uuid, bigint, bigint, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_staff_linkable(uuid, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public._assert_worker_mergeable(uuid, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_worker_to_staff_login(uuid, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_can_merge_worker_into_staff(uuid, bigint, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_worker_login_into_staff(uuid, bigint, bigint, uuid) TO service_role;
