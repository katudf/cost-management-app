ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS show_reform_logo boolean NOT NULL DEFAULT false;
ALTER TABLE public.estimates ALTER COLUMN show_net SET DEFAULT false;
ALTER TABLE public.estimates ALTER COLUMN show_approver SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.save_estimate_v3(
  p_estimate_id bigint, p_header jsonb, p_sheets jsonb, p_items jsonb,
  p_submit boolean DEFAULT false, p_approver_staff_id integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_header public.estimates;
  v_id bigint;
  v_result jsonb;
  v_sum numeric;
  v_total numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_admin() OR public.current_staff_role()='office', false) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;
  IF jsonb_typeof(p_header) IS DISTINCT FROM 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_header) k WHERE k NOT IN ('estimate_number', 'customer_id', 'customer_honorific', 'title', 'site_location', 'work_period', 'issue_date', 'valid_until', 'payment_terms', 'notes', 'tax_rate', 'show_net', 'show_subtotals', 'stamp_header', 'show_approver', 'show_reform_logo', 'staff_id', 'net_calc_type', 'net_perc', 'net_amount', 'total_with_tax', 'project_id')
  ) THEN RAISE EXCEPTION '保存対象外の表紙フィールドが含まれています。'; END IF;
  v_header := jsonb_populate_record(NULL::public.estimates, p_header);
  IF v_header.estimate_number !~ '^\d{6}-\d{4}-\d{3}$'
     OR v_header.estimate_number IS NULL OR v_header.customer_id IS NULL
     OR COALESCE(btrim(v_header.title),'')='' OR v_header.issue_date IS NULL
     OR v_header.payment_terms IS NULL OR v_header.tax_rate IS NULL OR v_header.tax_rate < 0 THEN
    RAISE EXCEPTION '顧客・工事名・見積番号・日付・支払条件・税率を確認してください。';
  END IF;
  IF p_submit AND NOT EXISTS (SELECT 1 FROM public.office_staff WHERE id=p_approver_staff_id AND is_approver) THEN
    RAISE EXCEPTION '有効な承認者を選択してください。';
  END IF;
  IF p_estimate_id IS NULL THEN
    INSERT INTO public.estimates (estimate_number, customer_id, customer_honorific, title, site_location, work_period, issue_date, valid_until, payment_terms, notes, tax_rate, show_net, show_subtotals, stamp_header, show_approver, show_reform_logo, staff_id, net_calc_type, net_perc, net_amount, total_with_tax, project_id) VALUES (v_header.estimate_number, v_header.customer_id, v_header.customer_honorific, v_header.title, v_header.site_location, v_header.work_period, v_header.issue_date, v_header.valid_until, v_header.payment_terms, v_header.notes, v_header.tax_rate, v_header.show_net, v_header.show_subtotals, v_header.stamp_header, true, COALESCE(v_header.show_reform_logo, false), v_header.staff_id, v_header.net_calc_type, v_header.net_perc, v_header.net_amount, v_header.total_with_tax, v_header.project_id) RETURNING id INTO v_id;
  ELSE
    SELECT id INTO v_id FROM public.estimates WHERE id=p_estimate_id AND status='draft' AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '保存できる下書き見積が見つかりません。'; END IF;
    UPDATE public.estimates SET estimate_number = v_header.estimate_number,
      customer_id = v_header.customer_id,
      customer_honorific = v_header.customer_honorific,
      title = v_header.title,
      site_location = v_header.site_location,
      work_period = v_header.work_period,
      issue_date = v_header.issue_date,
      valid_until = v_header.valid_until,
      payment_terms = v_header.payment_terms,
      notes = v_header.notes,
      tax_rate = v_header.tax_rate,
      show_net = v_header.show_net,
      show_subtotals = v_header.show_subtotals,
      stamp_header = v_header.stamp_header,
      show_approver = true,
      show_reform_logo = COALESCE(v_header.show_reform_logo, false),
      staff_id = v_header.staff_id,
      net_calc_type = v_header.net_calc_type,
      net_perc = v_header.net_perc,
      net_amount = v_header.net_amount,
      total_with_tax = v_header.total_with_tax,
      project_id = v_header.project_id WHERE id=v_id;
  END IF;
  v_result := public.save_estimate_items_v2(v_id, p_sheets, p_items);
  SELECT COALESCE(sum(amount),0) INTO v_sum FROM public.estimate_items
    WHERE estimate_id=v_id AND sheet_id=(v_result->'sheet_ids'->>0)::uuid AND item_type='item';
  v_total := v_sum + floor(v_sum * v_header.tax_rate);
  IF v_header.total_with_tax IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION '表紙の合計と明細の合計が一致していません。';
  END IF;
  IF p_submit THEN
    PERFORM set_config('app.estimates_save_rpc','1',true);
    UPDATE public.estimates SET status='pending', approver_staff_id=p_approver_staff_id WHERE id=v_id;
    PERFORM set_config('app.estimates_save_rpc','0',true);
  END IF;
  RETURN v_result || jsonb_build_object('id',v_id,'status',CASE WHEN p_submit THEN 'pending' ELSE 'draft' END);
END;
$$;
REVOKE ALL ON FUNCTION public.save_estimate_v3(bigint,jsonb,jsonb,jsonb,boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_estimate_v3(bigint,jsonb,jsonb,jsonb,boolean,integer) TO authenticated;
