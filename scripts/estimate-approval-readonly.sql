-- Run with: npx supabase db query --linked --file scripts/estimate-approval-readonly.sql -o json
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'functions', (SELECT jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'acl',proacl))
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
      'protect_estimate_approval_columns','protect_estimate_child_content','approve_estimate',
      'return_estimate','save_estimate_items_v2','save_estimate_v3','current_staff_role','is_admin','calc_estimate_item_amount')),
  'policies', (SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p
    WHERE schemaname='public' AND tablename IN ('estimates','estimate_items','estimate_sheets')),
  'triggers', (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'definition',pg_get_triggerdef(t.oid)))
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal
    AND c.oid IN ('public.estimates'::regclass,'public.estimate_items'::regclass,'public.estimate_sheets'::regclass)),
  'indexes', (SELECT jsonb_agg(to_jsonb(i)) FROM pg_indexes i WHERE schemaname='public'
    AND tablename IN ('estimates','estimate_items','estimate_sheets')),
  'duplicates', (SELECT jsonb_agg(to_jsonb(d)) FROM (
    SELECT estimate_number,count(*) FROM public.estimates GROUP BY estimate_number HAVING count(*)>1) d),
  'columns', (SELECT jsonb_agg(to_jsonb(c)) FROM (
    SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('estimates','estimate_items','estimate_sheets')
    ORDER BY table_name,ordinal_position) c)
) AS audit;
COMMIT;
