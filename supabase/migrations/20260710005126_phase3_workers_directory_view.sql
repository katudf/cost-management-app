-- 作業員名簿ビュー: 機微列（生年月日・住所・連絡先・CPDS・入社日）を隠して公開する
-- security_invoker は指定しない（= definer 扱い）ことで Workers のRLSを迂回し、
-- ビュー側の is_staff() で認可する
CREATE VIEW public.workers_directory AS
  SELECT id, name, display_order, worker_type, resignation_date
  FROM public."Workers"
  WHERE is_staff();

REVOKE ALL ON public.workers_directory FROM PUBLIC, anon;
GRANT SELECT ON public.workers_directory TO authenticated;

-- Workers 本体への worker ロール直接SELECTは不要になったため削除
DROP POLICY "workers_select_worker" ON public."Workers";
