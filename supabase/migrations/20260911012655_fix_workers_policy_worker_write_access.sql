-- =========================================================
-- Workers テーブル: worker ロールの書き込み権限を剥奪する
--
-- 【問題】
-- workers_office_all (cmd=ALL) の USING句が
--   is_admin() OR current_staff_role() IN ('office', 'worker')
-- となっており、worker ロールが Workers（従業員マスタ、個人情報含む）に対して
-- INSERT / UPDATE / DELETE を実行できてしまう状態だった。
-- with_check が未設定（null）のため、cmd=ALL ポリシーでは USING式が
-- WITH CHECK にも流用され、INSERT 時のチェックも同じ緩さになる。
--
-- 同種の Projects / Assignments では office_all（office/admin専用のALL）と
-- select_worker_viewer（worker/viewer専用のSELECTのみ）の2ポリシーに
-- 分離されており、worker は読み取り専用に制限されている。Workers だけが
-- 1本のALLポリシーにworkerを混ぜ込んでおり、他テーブルと設計が非対称だった。
--
-- 【ユーザー確認済みの意図】
-- 従業員が本システム上で更新できるのは作業日報（TaskRecords等）のみであり、
-- 従業員情報（Workers）の更新は admin / office のみが行える。
--
-- 【実装調査の裏付け】
-- Workers への書き込み（useWorkers.js の update/insert/delete）を呼び出しているのは
-- AdminApp.jsx のみ。WorkerApp.jsx は Workers を直接操作しておらず、
-- 読み取りも workers_directory ビュー経由（安全カラムのみ）で行っている。
-- つまり worker ロールがアプリの正規経路で Workers に書き込むことは無い。
-- RLSがworkerに書き込みを許していたのは実装意図とズレた「開けっ放し」であり、
-- ログイン済みworkerがAPIを直接叩けばWorkers（個人情報含む）を改ざんできる状態だった。
--
-- 【viewer に SELECT を追加しない理由】
-- Workers 基表には birthDate / address / contactInfo など個人情報カラムが
-- 含まれる。viewer 向けの閲覧経路は workers_directory ビュー
--   (id, name, display_order, worker_type, resignation_date のみを公開)
-- として既に確立されており（ScheduleViewApp.jsx 等が使用）、
-- Projects/Assignments に倣って viewer にも基表SELECTを開放すると
-- 個人情報カラムまで露出してしまうため、意図的に見送る。
--
-- 【対処】
-- 1. workers_office_all から worker を外し、office/admin 専用のALLポリシーにする。
--    ALTER POLICY ... USING (...) WITH CHECK (...) で式を明示的に書き換える
--    （ALTER POLICY は式の再定義が可能。USING省略時のWITH CHECK流用という
--     曖昧さを無くすため、ここではWITH CHECKも明示する）。
-- 2. workers_select_worker を新設し、worker に SELECT のみを許可する
--    （Projects/Assignments の select_worker_viewer に倣うが、viewer は含めない）。
-- =========================================================

alter policy workers_office_all
  on public."Workers"
  using (is_admin() OR (current_staff_role() = 'office'::text))
  with check (is_admin() OR (current_staff_role() = 'office'::text));

create policy workers_select_worker
  on public."Workers"
  for select
  to authenticated
  using (current_staff_role() = 'worker'::text);
