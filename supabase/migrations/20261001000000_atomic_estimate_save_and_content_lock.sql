-- Production definitions inspected 2026-10-01. Not applied to production.
-- Keep the existing full unique number index (including trash / restoration).
CREATE UNIQUE INDEX IF NOT EXISTS estimates_estimate_number_key
  ON public.estimates (estimate_number);

CREATE OR REPLACE FUNCTION public.protect_estimate_approval_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id integer;
  v_rpc boolean := COALESCE(current_setting('app.estimates_status_rpc', true), '') = '1';
  v_revert boolean;
  v_ignored text[] := ARRAY['status','updated_at','deleted_at','approved_by','approved_at','returned_reason','lost_reason','project_id'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION '新規見積は下書きとして作成してください。';
    END IF;
    RETURN NEW;
  END IF;
  v_revert := NEW.status = 'draft' AND OLD.status <> 'draft';
  -- Approval RPC flags never bypass the content comparison.
  IF (OLD.status <> 'draft' OR OLD.deleted_at IS NOT NULL) AND
     (to_jsonb(NEW) - v_ignored) IS DISTINCT FROM (to_jsonb(OLD) - v_ignored) THEN
    RAISE EXCEPTION '下書き以外の見積内容・承認者は変更できません。';
  END IF;
  IF v_revert THEN
    SELECT id INTO v_staff_id FROM public.office_staff WHERE auth_user_id = auth.uid();
    IF NOT public.is_admin() AND OLD.staff_id IS NOT NULL AND OLD.staff_id IS DISTINCT FROM v_staff_id THEN
      RAISE EXCEPTION '下書きに戻す操作は作成者本人のみ実行できます。';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.returned_reason := '';
    NEW.lost_reason := '';
  ELSE
    IF NOT v_rpc AND (
      (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','returned'))
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.returned_reason IS DISTINCT FROM OLD.returned_reason
    ) THEN
      RAISE EXCEPTION '承認・差し戻しは承認RPC経由でのみ実行できます。';
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_revert THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status = 'pending'
       AND COALESCE(current_setting('app.estimates_save_rpc', true), '') = '1')
      OR (OLD.status = 'pending' AND NEW.status IN ('approved','returned') AND v_rpc)
      OR (OLD.status = 'approved' AND NEW.status = 'submitted')
      OR (OLD.status = 'submitted' AND NEW.status IN ('ordered','lost'))
    ) THEN RAISE EXCEPTION '許可されていない見積ステータス遷移です。'; END IF;
  END IF;
  IF NEW.status = 'pending' AND NOT EXISTS (
    SELECT 1 FROM public.office_staff WHERE id = NEW.approver_staff_id AND is_approver
  ) THEN RAISE EXCEPTION '有効な承認者を選択してください。'; END IF;
  IF NEW.lost_reason IS DISTINCT FROM OLD.lost_reason AND NOT v_revert
     AND NOT (OLD.status = 'submitted' AND (
       NEW.status = 'lost' OR (NEW.status = 'ordered' AND COALESCE(NEW.lost_reason,'')='')
     )) THEN
    RAISE EXCEPTION '失注理由は失注への遷移時のみ変更できます。';
  END IF;
  -- Project linkage is separate from estimate contents and required by the order flow.
  IF NEW.project_id IS DISTINCT FROM OLD.project_id AND OLD.status <> 'draft'
     AND NEW.status <> 'ordered' AND NEW.project_id IS NOT NULL THEN
    RAISE EXCEPTION '工事案件への連携は受注時のみ変更できます。';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_estimate_approval_columns ON public.estimates;
CREATE TRIGGER trg_protect_estimate_approval_columns BEFORE INSERT OR UPDATE ON public.estimates
FOR EACH ROW EXECUTE FUNCTION public.protect_estimate_approval_columns();
REVOKE ALL ON FUNCTION public.protect_estimate_approval_columns() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_estimate_child_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id bigint;
  v_parent public.estimates;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estimate_id IS DISTINCT FROM OLD.estimate_id THEN
    RAISE EXCEPTION '明細・シートの所属見積は変更できません。';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END;
  SELECT * INTO v_parent FROM public.estimates WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Parent DELETE CASCADE: the parent has already been removed.
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    IF TG_TABLE_NAME = 'estimate_items' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
       AND (to_jsonb(NEW) - ARRAY['linked_sheet_id','linked_category_item_id','parent_id'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['linked_sheet_id','linked_category_item_id','parent_id'])
       AND ((to_jsonb(NEW)->>'linked_sheet_id') IS NULL OR (to_jsonb(NEW)->'linked_sheet_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->'linked_sheet_id'))
       AND ((to_jsonb(NEW)->>'linked_category_item_id') IS NULL OR (to_jsonb(NEW)->'linked_category_item_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->'linked_category_item_id'))
       AND ((to_jsonb(NEW)->>'parent_id') IS NULL OR (to_jsonb(NEW)->'parent_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->'parent_id')) THEN RETURN NEW; END IF;
    RAISE EXCEPTION '所属見積が見つかりません。';
  END IF;
  -- Preserve purge_expired_estimates, which explicitly deletes children first.
  IF TG_OP = 'DELETE' AND v_parent.deleted_at < now() - interval '30 days'
     AND (public.is_admin() OR public.current_staff_role() = 'office') THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME = 'estimate_items' AND TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
     AND v_parent.deleted_at < now() - interval '30 days'
     AND (public.is_admin() OR public.current_staff_role() = 'office')
     AND (to_jsonb(NEW) - ARRAY['linked_sheet_id','linked_category_item_id','parent_id'])
       IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['linked_sheet_id','linked_category_item_id','parent_id'])
     AND ((to_jsonb(NEW)->>'linked_sheet_id') IS NULL OR (to_jsonb(NEW)->'linked_sheet_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->'linked_sheet_id'))
     AND ((to_jsonb(NEW)->>'linked_category_item_id') IS NULL OR (to_jsonb(NEW)->'linked_category_item_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->'linked_category_item_id'))
     AND ((to_jsonb(NEW)->>'parent_id') IS NULL OR (to_jsonb(NEW)->'parent_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->'parent_id')) THEN RETURN NEW; END IF;
  IF v_parent.status <> 'draft' OR v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '下書き以外の見積明細・シートは変更できません。';
  END IF;
  IF TG_TABLE_NAME = 'estimate_items' AND TG_OP <> 'DELETE' THEN
    IF (NEW.sheet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.estimate_sheets WHERE id=NEW.sheet_id AND estimate_id=v_id))
       OR (NEW.linked_sheet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.estimate_sheets WHERE id=NEW.linked_sheet_id AND estimate_id=v_id))
       OR (NEW.linked_category_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.estimate_items WHERE id=NEW.linked_category_item_id AND estimate_id=v_id AND item_type='category')) THEN
      RAISE EXCEPTION 'リンク先・所属シートが同じ見積に属していません。';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER trg_protect_estimate_items_content BEFORE INSERT OR UPDATE OR DELETE ON public.estimate_items
FOR EACH ROW EXECUTE FUNCTION public.protect_estimate_child_content();
CREATE TRIGGER trg_protect_estimate_sheets_content BEFORE INSERT OR UPDATE OR DELETE ON public.estimate_sheets
FOR EACH ROW EXECUTE FUNCTION public.protect_estimate_child_content();
REVOKE ALL ON FUNCTION public.protect_estimate_child_content() FROM PUBLIC, anon, authenticated;

-- v2 remains available for legacy draft imports / duplication, with the same parent lock.
CREATE OR REPLACE FUNCTION public.save_estimate_items_v2(p_estimate_id bigint, p_sheets jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet_ids uuid[] := '{}';
  v_sheet_id  uuid;
  v_elem      jsonb;
  v_ord       int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_admin() OR public.current_staff_role() = 'office', false) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;
  PERFORM 1 FROM public.estimates WHERE id=p_estimate_id AND status='draft' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '保存できる下書き見積が見つかりません。'; END IF;
  IF jsonb_typeof(p_sheets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sheets)=0
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'シート・明細の形式が不正です。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_sheets) t(s)
    WHERE NULLIF(s->>'id','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.estimate_sheets es WHERE es.id=(s->>'id')::uuid AND es.estimate_id=p_estimate_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_sheets) t(s)
    WHERE NULLIF(s->>'id','') IS NOT NULL GROUP BY s->>'id' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'シートが所属見積に存在しないか重複しています。'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) t(elem)
    WHERE NULLIF(elem->>'sheet_index','') IS NULL
       OR (elem->>'sheet_index')::int NOT BETWEEN 0 AND jsonb_array_length(p_sheets)-1
       OR (NULLIF(elem->>'linked_sheet_index','') IS NOT NULL AND
           (elem->>'linked_sheet_index')::int NOT BETWEEN 0 AND jsonb_array_length(p_sheets)-1)
       OR (NULLIF(elem->>'linked_item_index','') IS NOT NULL AND
           (elem->>'linked_item_index')::int NOT BETWEEN 0 AND jsonb_array_length(p_items)-1)
  ) THEN RAISE EXCEPTION '明細のシート・リンク参照が不正です。'; END IF;

  DELETE FROM public.estimate_sheets es
  WHERE es.estimate_id = p_estimate_id
    AND es.id NOT IN (
      SELECT NULLIF(t.s->>'id', '')::uuid
      FROM jsonb_array_elements(COALESCE(p_sheets, '[]'::jsonb)) AS t(s)
      WHERE NULLIF(t.s->>'id', '') IS NOT NULL
    );

  FOR v_elem IN SELECT s FROM jsonb_array_elements(COALESCE(p_sheets, '[]'::jsonb)) AS t(s)
  LOOP
    v_ord := v_ord + 1;
    v_sheet_id := NULLIF(v_elem->>'id', '')::uuid;
    IF v_sheet_id IS NULL THEN
      INSERT INTO public.estimate_sheets (estimate_id, sort_order, title)
      VALUES (p_estimate_id, v_ord, v_elem->>'title')
      RETURNING id INTO v_sheet_id;
    ELSE
      UPDATE public.estimate_sheets
      SET sort_order = v_ord, title = v_elem->>'title'
      WHERE id = v_sheet_id AND estimate_id = p_estimate_id;
    END IF;
    v_sheet_ids := array_append(v_sheet_ids, v_sheet_id);
  END LOOP;

  DELETE FROM public.estimate_items
  WHERE estimate_id = p_estimate_id;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('sheet_ids', to_jsonb(v_sheet_ids));
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS t(elem)
    WHERE NULLIF(t.elem->>'linked_sheet_index', '') IS NOT NULL
      AND (t.elem->>'linked_sheet_index')::int = (t.elem->>'sheet_index')::int
  ) THEN
    RAISE EXCEPTION 'linked_sheet_index must not reference own sheet';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(elem, ord)
    WHERE NULLIF(t.elem->>'linked_item_index', '') IS NOT NULL
      AND (
        (t.elem->>'linked_item_index')::int = (t.ord - 1)::int
        OR COALESCE((
          SELECT t2.elem2->>'item_type'
          FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t2(elem2, ord2)
          WHERE (t2.ord2 - 1)::int = (t.elem->>'linked_item_index')::int
        ), '') <> 'category'
      )
  ) THEN
    RAISE EXCEPTION 'linked_item_index must reference a category row';
  END IF;

  INSERT INTO public.estimate_items (
    estimate_id,
    sheet_id,
    linked_sheet_id,
    sort_order,
    item_type,
    category_symbol,
    name,
    spec,
    quantity,
    unit,
    unit_price,
    amount,
    note
  )
  SELECT
    p_estimate_id,
    v_sheet_ids[NULLIF(t.elem->>'sheet_index', '')::int + 1],
    CASE WHEN NULLIF(t.elem->>'linked_sheet_index', '') IS NOT NULL
         THEN v_sheet_ids[(t.elem->>'linked_sheet_index')::int + 1]
    END,
    (t.ord - 1)::int,
    t.elem->>'item_type',
    t.elem->>'category_symbol',
    COALESCE(t.elem->>'name', ''),
    t.elem->>'spec',
    NULLIF(t.elem->>'quantity', '')::numeric,
    t.elem->>'unit',
    NULLIF(t.elem->>'unit_price', '')::numeric,
    NULLIF(t.elem->>'amount', '')::numeric,
    t.elem->>'note'
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(elem, ord);

  UPDATE public.estimate_items i
  SET linked_category_item_id = tgt.id
  FROM (
    SELECT (t.ord - 1)::int AS idx,
           (t.elem->>'linked_item_index')::int AS linked_idx
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(elem, ord)
    WHERE NULLIF(t.elem->>'linked_item_index', '') IS NOT NULL
  ) src
  JOIN public.estimate_items tgt
    ON tgt.estimate_id = p_estimate_id AND tgt.sort_order = src.linked_idx
  WHERE i.estimate_id = p_estimate_id AND i.sort_order = src.idx;

  RETURN jsonb_build_object('sheet_ids', to_jsonb(v_sheet_ids));
END;
$function$;



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
    SELECT 1 FROM jsonb_object_keys(p_header) k WHERE k NOT IN ('estimate_number', 'customer_id', 'customer_honorific', 'title', 'site_location', 'work_period', 'issue_date', 'valid_until', 'payment_terms', 'notes', 'tax_rate', 'show_net', 'show_subtotals', 'stamp_header', 'show_approver', 'staff_id', 'net_calc_type', 'net_perc', 'net_amount', 'total_with_tax', 'project_id')
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
    INSERT INTO public.estimates (estimate_number, customer_id, customer_honorific, title, site_location, work_period, issue_date, valid_until, payment_terms, notes, tax_rate, show_net, show_subtotals, stamp_header, show_approver, staff_id, net_calc_type, net_perc, net_amount, total_with_tax, project_id) VALUES (v_header.estimate_number, v_header.customer_id, v_header.customer_honorific, v_header.title, v_header.site_location, v_header.work_period, v_header.issue_date, v_header.valid_until, v_header.payment_terms, v_header.notes, v_header.tax_rate, v_header.show_net, v_header.show_subtotals, v_header.stamp_header, v_header.show_approver, v_header.staff_id, v_header.net_calc_type, v_header.net_perc, v_header.net_amount, v_header.total_with_tax, v_header.project_id) RETURNING id INTO v_id;
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
      show_approver = v_header.show_approver,
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
REVOKE EXECUTE ON FUNCTION public.save_estimate_items_v2(bigint,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_estimate_items_v2(bigint,jsonb,jsonb) TO authenticated;
