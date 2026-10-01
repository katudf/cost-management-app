-- Read-only live definitions captured 2026-10-01; no production data.
CREATE OR REPLACE FUNCTION public.approve_estimate(p_estimate_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id integer;
  v_staff_name text;
  v_status text;
  v_approver_staff_id integer;
BEGIN
  SELECT id, name INTO v_staff_id, v_staff_name
    FROM office_staff WHERE auth_user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION '担当者情報が見つかりません。';
  END IF;

  SELECT status, approver_staff_id INTO v_status, v_approver_staff_id
    FROM estimates WHERE id = p_estimate_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の見積が見つかりません。';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'この見積は承認依頼中ではないため承認できません。';
  END IF;
  IF v_approver_staff_id IS DISTINCT FROM v_staff_id THEN
    RAISE EXCEPTION '指名された承認者のみが承認できます。';
  END IF;

  PERFORM set_config('app.estimates_status_rpc', '1', true);
  UPDATE estimates
     SET status = 'approved',
         approved_by = v_staff_name,
         approved_at = now(),
         returned_reason = '',
         updated_at = now()
   WHERE id = p_estimate_id;
  PERFORM set_config('app.estimates_status_rpc', '0', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM office_staff WHERE auth_user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid() AND role = 'admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.return_estimate(p_estimate_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id integer;
  v_status text;
  v_approver_staff_id integer;
BEGIN
  SELECT id INTO v_staff_id
    FROM office_staff WHERE auth_user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION '担当者情報が見つかりません。';
  END IF;

  SELECT status, approver_staff_id INTO v_status, v_approver_staff_id
    FROM estimates WHERE id = p_estimate_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の見積が見つかりません。';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'この見積は承認依頼中ではないため差し戻しできません。';
  END IF;
  IF v_approver_staff_id IS DISTINCT FROM v_staff_id THEN
    RAISE EXCEPTION '指名された承認者のみが差し戻しできます。';
  END IF;

  PERFORM set_config('app.estimates_status_rpc', '1', true);
  UPDATE estimates
     SET status = 'returned',
         returned_reason = COALESCE(p_reason, ''),
         updated_at = now()
   WHERE id = p_estimate_id;
  PERFORM set_config('app.estimates_status_rpc', '0', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$

BEGIN

  NEW.updated_at := now();

  RETURN NEW;

END;

$function$;

ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY estimate_items_office_all ON public.estimate_items FOR ALL TO authenticated
USING (is_admin() OR current_staff_role()='office') WITH CHECK (is_admin() OR current_staff_role()='office');
CREATE POLICY estimate_sheets_office_all ON public.estimate_sheets FOR ALL TO authenticated
USING (is_admin() OR current_staff_role()='office') WITH CHECK (is_admin() OR current_staff_role()='office');
CREATE TRIGGER trg_estimates_updated_at BEFORE UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
REVOKE ALL ON FUNCTION public.approve_estimate(bigint),public.return_estimate(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_estimate(bigint),public.return_estimate(bigint,text) TO authenticated;
-- estimates_office_all を コマンド別ポリシーへ分割する
DROP POLICY IF EXISTS estimates_office_all ON estimates;

CREATE POLICY estimates_office_select ON estimates
  FOR SELECT TO authenticated
  USING ((is_admin() OR current_staff_role() = 'office') AND deleted_at IS NULL);

CREATE POLICY estimates_office_insert ON estimates
  FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

CREATE POLICY estimates_office_update ON estimates
  FOR UPDATE TO authenticated
  USING ((is_admin() OR current_staff_role() = 'office') AND deleted_at IS NULL)
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

CREATE POLICY estimates_office_delete ON estimates
  FOR DELETE TO authenticated
  USING ((is_admin() OR current_staff_role() = 'office') AND deleted_at IS NULL);
-- SELECT から deleted_at IS NULL を外す
-- （ソフト削除された見積を「削除済み」一覧に表示し、復元できるようにするため）
DROP POLICY IF EXISTS estimates_office_select ON estimates;

CREATE POLICY estimates_office_select ON estimates
  FOR SELECT TO authenticated
  USING (is_admin() OR current_staff_role() = 'office');
-- 削除済み見積書の復元機能を追加。
-- 既存の estimates_office_update ポリシーは USING句に deleted_at IS NULL を要求するため、
-- 削除済み行（deleted_at IS NOT NULL）に対するUPDATE（復元含む）が常にRLS違反になる。
-- 20260713000000 と同じ理由でポリシーをそのままにはできないため、
-- 復元・完全削除は SECURITY DEFINER の RPC 経由に限定し、
-- 通常のUPDATEポリシーは削除済み行を対象外のまま維持する（誤操作防止）。

-- ============================================================
-- 見積書の復元（論理削除の取り消し）
-- 削除から30日以内のみ復元可能
-- ============================================================
CREATE OR REPLACE FUNCTION restore_estimate(p_estimate_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_at timestamptz;
BEGIN
  IF NOT (is_admin() OR current_staff_role() = 'office') THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT deleted_at INTO v_deleted_at
  FROM estimates
  WHERE id = p_estimate_id
  FOR UPDATE;

  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION '削除されていない見積書です';
  END IF;

  IF v_deleted_at < now() - interval '30 days' THEN
    RAISE EXCEPTION '削除から30日を過ぎているため復元できません';
  END IF;

  UPDATE estimates SET deleted_at = NULL WHERE id = p_estimate_id;
END;
$$;

-- ============================================================
-- 削除済み見積書の完全削除（物理削除）
-- 30日を過ぎた削除済み見積りのみ対象。管理者が手動実行する想定。
-- estimate_items の外部キーにON DELETE CASCADEが設定されているか
-- 移行ファイル上で確認できないため、明細を先に明示的に削除する。
-- ============================================================
CREATE OR REPLACE FUNCTION purge_expired_estimates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (is_admin() OR current_staff_role() = 'office') THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  DELETE FROM estimate_items
  WHERE estimate_id IN (
    SELECT id FROM estimates
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'
  );

  DELETE FROM estimates
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '30 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
