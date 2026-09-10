-- =========================================================
-- 塗料データベース系 RLSポリシーの対象ロールを authenticated に限定する
--
-- 【問題】
-- 20260817054518 / 20260818042423 で作成した塗料DB系13テーブル・26ポリシーは
-- create policy に TO 句を書いていない。PostgreSQL は TO 句省略時に
-- 「TO public」を既定とするため、pg_policies 上は roles = {public} となり、
-- 未認証ロール anon もポリシー評価の対象に含まれてしまっている。
-- （他テーブルは TO authenticated が明示されており、書き方が揃っていない）
--
-- 【現状で実害が出ていない理由 = 脆い理由】
-- ポリシー式が is_admin() / current_staff_role() を呼ぶところ、
-- 20260710010136 でこれらの EXECUTE を anon から剥奪しているため、
-- anon のアクセスは「ポリシーで0件」ではなく「関数の権限エラー(42501)」で
-- 止まっている。つまり防波堤は無関係な EXECUTE 権限ひとつだけであり、
-- 将来どこかで anon に EXECUTE を戻した瞬間に評価が走る状態になっている。
-- 多層防御として、ポリシー自身の対象ロールも絞る。
--
-- 【DROP+CREATE ではなく ALTER POLICY を使う理由】
-- ALTER POLICY ... TO <role> はロールリストのみを差し替え、
-- USING / WITH CHECK 式には一切触れない。26本を書き写す必要がなく、
-- 転記ミスでポリシー式を壊す危険がない。
-- =========================================================

-- 20260817054518 で作成（8テーブル・16ポリシー）
alter policy paint_manufacturers_office_all           on public.paint_manufacturers           to authenticated;
alter policy paint_manufacturers_select_worker_viewer on public.paint_manufacturers           to authenticated;

alter policy paint_process_roles_office_all           on public.paint_process_roles           to authenticated;
alter policy paint_process_roles_select_worker_viewer on public.paint_process_roles           to authenticated;

alter policy paint_products_office_all               on public.paint_products                to authenticated;
alter policy paint_products_select_worker_viewer     on public.paint_products                to authenticated;

alter policy paint_classification_axes_office_all           on public.paint_classification_axes to authenticated;
alter policy paint_classification_axes_select_worker_viewer on public.paint_classification_axes to authenticated;

alter policy paint_classification_tags_office_all           on public.paint_classification_tags to authenticated;
alter policy paint_classification_tags_select_worker_viewer on public.paint_classification_tags to authenticated;

alter policy paint_product_tags_office_all           on public.paint_product_tags            to authenticated;
alter policy paint_product_tags_select_worker_viewer on public.paint_product_tags            to authenticated;

alter policy coating_systems_office_all              on public.coating_systems               to authenticated;
alter policy coating_systems_select_worker_viewer    on public.coating_systems               to authenticated;

alter policy coating_system_steps_office_all           on public.coating_system_steps        to authenticated;
alter policy coating_system_steps_select_worker_viewer on public.coating_system_steps        to authenticated;

-- 20260818042423 で作成（5テーブル・10ポリシー）
alter policy coating_system_variants_office_all           on public.coating_system_variants  to authenticated;
alter policy coating_system_variants_select_worker_viewer on public.coating_system_variants  to authenticated;

alter policy paint_standards_office_all              on public.paint_standards               to authenticated;
alter policy paint_standards_select_worker_viewer    on public.paint_standards               to authenticated;

alter policy paint_product_standards_office_all           on public.paint_product_standards  to authenticated;
alter policy paint_product_standards_select_worker_viewer on public.paint_product_standards  to authenticated;

alter policy paint_abbreviations_office_all           on public.paint_abbreviations          to authenticated;
alter policy paint_abbreviations_select_worker_viewer on public.paint_abbreviations          to authenticated;

alter policy coating_system_abbreviations_office_all           on public.coating_system_abbreviations to authenticated;
alter policy coating_system_abbreviations_select_worker_viewer on public.coating_system_abbreviations to authenticated;
