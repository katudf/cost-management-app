-- 見積承認/差戻しを RPC 経由に限定する（指名された承認者のみ実行可）
CREATE OR REPLACE FUNCTION public.approve_estimate(p_estimate_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id bigint;
  v_est record;
BEGIN
  SELECT id INTO v_staff_id FROM office_staff WHERE auth_user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION '担当者として登録されていません。';
  END IF;

  SELECT * INTO v_est FROM estimates
   WHERE id = p_estimate_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '見積が見つかりません。';
  END IF;

  IF v_est.status <> 'pending' THEN
    RAISE EXCEPTION '承認待ちの見積のみ承認できます。';
  END IF;

  IF v_est.approver_staff_id IS DISTINCT FROM v_staff_id THEN
    RAISE EXCEPTION '指名された承認者のみが承認できます。';
  END IF;

  PERFORM set_config('app.estimates_status_rpc', '1', true);
  UPDATE estimates
     SET status = 'approved',
         approved_by = v_staff_id,
         approved_at = now()
   WHERE id = p_estimate_id;
  PERFORM set_config('app.estimates_status_rpc', '0', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.return_estimate(p_estimate_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id bigint;
  v_est record;
BEGIN
  SELECT id INTO v_staff_id FROM office_staff WHERE auth_user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION '担当者として登録されていません。';
  END IF;

  SELECT * INTO v_est FROM estimates
   WHERE id = p_estimate_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '見積が見つかりません。';
  END IF;

  IF v_est.status <> 'pending' THEN
    RAISE EXCEPTION '承認待ちの見積のみ差し戻せます。';
  END IF;

  IF v_est.approver_staff_id IS DISTINCT FROM v_staff_id THEN
    RAISE EXCEPTION '指名された承認者のみが差し戻せます。';
  END IF;

  PERFORM set_config('app.estimates_status_rpc', '1', true);
  UPDATE estimates
     SET status = 'returned',
         approved_by = NULL,
         approved_at = NULL,
         return_reason = p_reason
   WHERE id = p_estimate_id;
  PERFORM set_config('app.estimates_status_rpc', '0', true);
END;
$$;

-- 直接UPDATEによるステータス改竄を防ぐトリガー
CREATE OR REPLACE FUNCTION public.protect_estimate_approval_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.estimates_status_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'returned') THEN
    RAISE EXCEPTION '承認/差戻しは approve_estimate / return_estimate から実行してください。';
  END IF;

  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'approved_by / approved_at は直接更新できません。';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_estimate_approval_columns ON estimates;
CREATE TRIGGER trg_protect_estimate_approval_columns
  BEFORE UPDATE ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION protect_estimate_approval_columns();

REVOKE ALL ON FUNCTION public.approve_estimate(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_estimate(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_estimate(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_estimate(bigint, text) TO authenticated;
