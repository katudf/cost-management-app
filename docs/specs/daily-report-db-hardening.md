# 日報まわりの DB 権限・整合性 改善設計書

- 作成日: 2026-11-20
- 状態: §1.1 の論点は 2026-11-20 にユーザーが推奨案で決定済み。
  M1（DB-3）は実装済み（2026-11-20。`supabase/migrations/20261120000000_close_shared_worker_account.sql`、画面は `StaffLoginDialog.jsx` / `StaffSettings.jsx`、
  テストは `scripts/test-daily-report-hardening-db.py`）。
  M2 も実装済み（2026-11-20。`supabase/migrations/20261120010000_daily_report_rpc_v2.sql`。実装で変えた点は §5.1）。
  画面（F1）も実装済み（2026-11-20。実装で変えた点は §6.3）。
  **M1・M2 は本番に未反映**（§7.1 の確認の後に入れる）。F1 は M2 が無い DB でも従来どおり動く。M3・M4・F2 は未実装
- 対象: `docs/specs/worker-daily-report-refactor.md` §9 の DB-1〜DB-7・DB-9（DB-8・DB-10・DB-11 は対象外。§10）
- 根拠: リポジトリのマイグレーション（2026-11-20 時点の最新 `20261117000000`）と画面のコード（コミット `f789415`）。
  本番の RLS・関数がマイグレーションどおりかは、§7.1 のクエリで本番を見てから実装に入る
- 関連: `docs/specs/worker-login.md`（§3.4「フェーズAで残るリスク」と §8「次の段階」がこの設計の出発点）、
  `docs/specs/security-permissions.md`

---

## 1. 目的と決めたこと

作業員の個人ログイン（`worker-login.md`）で「画面と RPC でのなりすまし」は防げるようになったが、
テーブルの RLS は共有アカウントの時代のままで、REST を直接叩けば他人の日報を書き換えたり、全員分の日報・金額を読んだりできる。
また、日報保存の RPC は「誰の行か」しか見ておらず、日付・現場の取り違えや、他の人が直した内容の上書きを止められない。
これらを DB 側で塞ぐ。

| 項目 | 決定（案） |
|---|---|
| 進め方 | 「互換のある追加（RPC の引数・ビュー・列）」→「画面」→「RLS を絞る」→「必須化」の順に分けて入れる（§6）。どの段階でも、1 つ前の画面が動き続けるようにする |
| 書き込みの経路 | 作業員の個人アカウントは、日報（`TaskRecords`）・休憩設定（`WorkerDailyBreakSettings`）・承認申請を **RPC 経由でしか書けない**ようにする。担当者（office 以上）は今までどおり直接書ける（管理画面の `InputTab` などを変えないため） |
| 読み取りの範囲 | 作業員は「自分の行」と「自分が職長の現場の行」だけ。配置表に要る「誰がどの現場に出たか」は、時間を含まない RPC で返す |
| 金額の列 | 作業員・閲覧者は `Projects` の基表を読めなくし、金額を含まないビュー `projects_directory` を読む（`workers_directory` と同じ作り）。列単位の権限は使わない（§4.8） |
| 楽観ロック | `TaskRecords` に `updated_at` を足し、画面が読んだときの値を送らせる。違っていたら何も保存せずに知らせる |
| 共有アカウント | `office_staff.role = 'worker'` を DB で作れなくし、`_effective_worker` の「申告どおり」の分岐を担当者だけにする（`worker-login.md` §6 フェーズB の 3） |

### 1.1 ユーザーと決めたこと（2026-11-20、すべて推奨案で決定）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| Q1 | 画面が読んだ後に管理者が日報の行を消していたとき、送信で「追加し直す」（今の `fallback_insert`）か「競合として止める」か | **止める**（読んだときの版が送られてきたときだけ。古い画面は M4 までは今のまま追加し直す） | 今の動きは F0-1（消した日報の復活・二重計上）の原因。止めれば、作業員が画面で消えたことに気付ける |
| Q2 | 旧画面（版を送らない画面）からの保存を、いつまで受け付けるか | 新しい画面を出してから **2 週間**。§7.3 のクエリで旧画面からの保存が無くなったのを見てから必須にする（M4） | PWA のキャッシュで古い画面が残るため |
| Q3 | 職長が承認するときに「画面で見た値」が変わっていたら | **止めて一覧を読み直させる** | 見ていない時間で承認されるのを防ぐのが DB-6 の目的 |
| Q4 | 閲覧者（viewer）にも `Projects` の基表を閉じるか | **閉じる**（工程表は `projects_directory` を読む） | 閲覧者に金額を見せる理由が無い。工程表が使う列はビューにすべてある |
| Q5 | M3 で旧画面の現場一覧が空になる件（§6.1）を避けるため、DB-9 のポリシーの削除を M4 に回すか | **回さない**（M3 で削除する） | 金額の列が見える期間を延ばさない。残った端末には再読み込みを頼む |

---

## 2. 現状（マイグレーションで確かめたこと）

### 2.1 ログインの種類とロール判定

| ログインの種類 | `current_staff_role()` | `is_personal_worker()` | `is_office_or_admin()` | `_effective_worker` の結果 |
|---|---|---|---|---|
| 担当者（admin / system_admin / office） | その role | false | true | 引数のまま（代理入力） |
| 担当者兼作業員（`link_staff_account` 済み） | 担当者の role | false | true | 引数のまま |
| 作業員の個人アカウント | `'worker'`（`Workers.auth_user_id` から） | true | false | 本人に置き換え |
| 共有アカウント（`office_staff.role = 'worker'`） | `'worker'` | false | false | **引数のまま（申告値）** ← DB-3 |
| 閲覧者（`office_staff.role = 'viewer'`） | `'viewer'` | false | false | 引数のまま（ただし各 RPC の role 判定で弾かれる） |
| 退職者・紐付け無し | `'none'` | false | false | 引数のまま（各 RPC の role 判定で弾かれる） |

出典: `20261107020000_worker_personal_login.sql:83-127`（`current_worker_id` / `is_personal_worker` / `current_staff_role`）、198-213（`_effective_worker`）。

### 2.2 いまの RLS

| テーブル | ポリシー | 内容 | 出典 |
|---|---|---|---|
| `TaskRecords` | `task_records_staff_all` | FOR ALL、`is_admin() OR current_staff_role() IN ('office','worker')`。行の絞り込みなし | `20260710002406:12-16`（以降の変更なし） |
| `WorkerDailyBreakSettings` | `worker_daily_break_settings_staff_all` | 同上（FOR ALL、worker も可、行の絞り込みなし） | `20260930000000:14-18` |
| `OvertimeApprovals` | `overtime_approvals_office_all` / `overtime_approvals_select_worker` | 書き込みは office 以上。worker は **全行を SELECT 可** | `20260710002406:56-64` |
| `WorkAllowanceApprovals` | `work_allowance_approvals_office_all` / `work_allowance_approvals_select_worker` | 同上 | `20260710002406:66-74` |
| `Projects` | `projects_office_all` / `projects_select_worker_viewer` | worker・viewer は **全列を SELECT 可**（`estimatedAmount` / `finalAmount` / `taxAmount` / `isPaid` / `estimatePdfUrl` / `contractPdfUrl` / `customerId` を含む） | `20260710002254:4-11` |

`current_staff_role() = 'worker'` は、`20261107020000` から作業員の個人アカウントでも真になった（同ファイル 106-107 のコメントどおり、ポリシーを書き換えずに作業員アカウントへ広げた）。
そのため上の表の「worker」は、共有アカウントと個人アカウントの両方を指す。

### 2.3 日報まわりの RPC（いずれも SECURITY DEFINER、最新版）

| 関数 | 最新の定義 | 作業員の決め方 |
|---|---|---|
| `save_daily_report(jsonb)` | `20261107020000:237-384` | `_effective_worker` |
| `delete_worker_project_day(bigint, text, date)` | `20261107020000:387-416` | `_effective_worker` |
| `add_project_task(bigint, text, bigint, bigint, text)` | `20261107020000:419-456` | `_effective_worker` |
| `approve_overtime(bigint, text, bigint)` / `approve_work_allowance(bigint, text, bigint)` | `20261107020000:460-542` | `_effective_worker` + `is_declared_foreman` |
| `acknowledge_approvals(text, bigint, bigint[], bigint[])` | `20261107020000:545-583` | `_effective_worker` + `is_declared_worker` |
| `save_worker_day_leave` / `get_substitute_holiday_candidates` | `20261116000000:80-248` | `_effective_worker` |
| 内部: `_upsert_task_record` / `_sync_overtime_approval` / `_sync_work_allowance_approval` | `20261105030000:122-252` | （呼び出し側で決めた作業員） |

`TaskRecords` には `updated_at` 列が無い（`src/types/supabase.ts` の Row と `docs/specs/database.md` の定義、マイグレーションのどこにも追加が無い）。
`OvertimeApprovals` / `WorkAllowanceApprovals` には `updated_at` があり、`_sync_*` が保存のたびに `now()` を入れる。

### 2.4 画面からの直接アクセス（DB-1・DB-2・DB-9 の影響を受ける箇所）

| 箇所 | テーブル | 操作 | 使うログイン | この設計での扱い |
|---|---|---|---|---|
| `src/hooks/useDailyReport.js:142-150` `saveWorkerDailyBreakSettings` | `WorkerDailyBreakSettings` | upsert | 作業員・担当者（代理） | DB-7 で `save_daily_report` に入れる。旧 DB 向けの予備としてだけ残し、M4 の後に消す |
| `src/hooks/useDailyReport.js:214-218`（`deleteProjectDayRecords` の予備） | `TaskRecords` | delete | 作業員・担当者 | RPC が無い DB 向けの予備。本番に `delete_worker_project_day` があるので消す |
| `src/hooks/useDailyReport.js:39-62, 93-96, 110-136` | `TaskRecords` / `WorkerDailyBreakSettings` | select | 作業員・担当者 | 本人の行・職長の現場の行だけなので、絞った後もそのまま動く |
| `src/hooks/useDailyReport.js:35-36` `fetchProjectsResult` | `Projects` | select `*` | 作業員・担当者 | DB-9 で `projects_directory` に変える |
| `src/hooks/useWorkerAssignments.js:56-58` | `TaskRecords` | select（全員分の `id, project_id, worker_name, date`） | 作業員 | **DB-2 で読めなくなる**。新しい RPC `get_task_record_presence` に変える |
| `src/hooks/useWeeklyReportData.js:62-67` | `TaskRecords` | select（本人分） | 作業員・担当者 | そのまま |
| `src/lib/overtimeApprovals.js:20-30` `fetchPendingApprovals` | `OvertimeApprovals` | select（職長の現場） | 作業員 | そのまま（職長の現場は読める） |
| `src/lib/overtimeApprovals.js:57-68, 80-89` | `OvertimeApprovals` | select（本人分） | 作業員 | そのまま |
| `src/lib/workAllowanceApprovals.js:20-55` | `WorkAllowanceApprovals` / `TaskRecords` | select（職長の現場） | 作業員 | そのまま |
| `src/lib/approvalNotices.js:20-33` | 承認 2 表 | select（本人分） | 作業員 | そのまま |
| `src/hooks/useScheduleViewData.js:19-35` | `Projects` | select（安全な列だけ） | 閲覧者・担当者・作業員 | DB-9 で `projects_directory` に変える |
| `src/hooks/useProjects.js:428-466`（`InputTab` の日報追加・削除・更新） | `TaskRecords` | insert / delete / update | 担当者のみ | そのまま（office 以上は直接書ける） |
| `src/hooks/useSupabaseData.js:79-85, 251-257`、`useAssignmentState.js:227-231`、`useProjectNinku.js`、`useCustomerSettingsData.js`、`supabaseEstimates.js` | `TaskRecords` / `Projects` | select / update | 担当者のみ | そのまま |

Edge Function（`supabase/functions/`）からの `TaskRecords` などへの直接アクセスは無い。

---

## 3. 新しく足す共通の部品

RLS の行判定で使う。どれも SECURITY DEFINER で、ポリシーの中では `(SELECT ...)` で囲んで 1 回だけ評価させる
（`TaskRecords` は `fetchAllPages` で全件読むことがあるため、行ごとに関数を呼ばない）。

```sql
-- ログイン中の作業員の名前（btrim 済み）。作業員でなければ NULL
CREATE OR REPLACE FUNCTION public.current_worker_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(btrim(w.name), '') FROM "Workers" w WHERE w.id = public.current_worker_id();
$$;

-- ログイン中の作業員が職長の現場の id。作業員でなければ空配列
CREATE OR REPLACE FUNCTION public.my_foreman_project_ids()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(p.id), '{}')
    FROM "Projects" p
   WHERE p.foreman_worker_id IS NOT NULL
     AND p.foreman_worker_id = public.current_worker_id();
$$;

REVOKE EXECUTE ON FUNCTION public.current_worker_name() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_foreman_project_ids() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_worker_name() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_foreman_project_ids() TO authenticated;
```

`my_foreman_project_ids()` は `Projects` を読むが SECURITY DEFINER なので、DB-9 で作業員が `Projects` の基表を読めなくなっても動く。

---

## 4. 項目ごとの設計

### 4.1 DB-3: 共有アカウントの申告値で、誰の日報でも書け、承認もできる

**問題**: `_effective_worker`（`20261107020000:198-213`）は、作業員の個人アカウント以外では引数をそのまま使う。
`office_staff.role = 'worker'` の行（共有アカウント）でログインすれば、`current_staff_role() = 'worker'` で各 RPC の role 判定を通り、
申告した名前・ID の作業員として日報を保存でき、職長の名前と ID を申告すれば承認もできる。

**本番の状況**: `worker-login.md` の冒頭によると、フェーズAは 2026-11-09 に本番反映済みで、共有アカウント（`office_staff.id=18`）も同日に削除済み。
フェーズBの 3（RPC の共有アカウント向け分岐を消す）と 4 は未着手。
ただし、管理者は今も担当者の行の role を `worker` にできる（`office_staff_role_check` が `worker` を許している。`20261026000000:5-7`。
画面の選択肢 `STAFF_ROLE_LIST` からは外れているが、`StaffLoginDialog.jsx:25` の `SHARED_ROLES` には残っている）。
role が `worker` の担当者行が 1 つでもあれば穴が開くので、DB で作れなくする。

**SQL 案（M1）**:

```sql
-- 事前確認: role = 'worker' の担当者行が残っていたら止める（残っていれば、先に削除するか role を変える）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.office_staff WHERE role = 'worker') THEN
    RAISE EXCEPTION 'role = worker の担当者行が残っています。先に削除するか role を変えてください。';
  END IF;
END $$;

-- 担当者の role から worker を外す（作業員のログインは Workers.auth_user_id で持つ）
ALTER TABLE public.office_staff DROP CONSTRAINT IF EXISTS office_staff_role_check;
ALTER TABLE public.office_staff ADD CONSTRAINT office_staff_role_check
  CHECK (role IN ('admin', 'system_admin', 'office', 'viewer'));

-- 申告どおりに使うのは担当者（代理入力）だけ。それ以外（閲覧者・ロール無し）は NULL を返し、呼び出し側で弾く
CREATE OR REPLACE FUNCTION public._effective_worker(
  p_worker_id bigint, p_worker_name text, OUT worker_id bigint, OUT worker_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_personal_worker() THEN
    SELECT w.id, NULLIF(btrim(w.name), '') INTO worker_id, worker_name
      FROM "Workers" w WHERE w.id = public.current_worker_id();
  ELSIF public.is_office_or_admin() THEN
    worker_id := p_worker_id;
    worker_name := NULLIF(btrim(p_worker_name), '');
  ELSE
    worker_id := NULL;
    worker_name := NULL;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._effective_worker(bigint, text) FROM anon, PUBLIC, authenticated;
```

CHECK を変えた後は `current_staff_role() = 'worker'` が個人アカウントだけで真になるので、各 RPC の role 判定（`COALESCE(current_staff_role() = 'worker', false)`）は書き換えなくても「作業員の個人アカウント」の意味になる。
`_effective_worker` が NULL を返したときの各 RPC の動き:

| RPC | NULL のときの動き |
|---|---|
| `save_daily_report` | `22023`「日報の保存内容が不正です」（M2 で `42501` の文言に直す。§4.4） |
| `delete_worker_project_day` | `22023`「削除する日報の指定が不正です」 |
| `approve_*` | `is_declared_foreman(…, NULL, NULL)` が false で `42501` |
| `acknowledge_approvals` | `42501` |
| `save_worker_day_leave` / `get_substitute_holiday_candidates` | `v_worker_id IS NULL` で弾く（`20261116000000:97, 167`） |
| `add_project_task` | role が `worker` にならないので `42501` |

**フロント**: `src/components/tabs/settings/StaffLoginDialog.jsx:25` の `SHARED_ROLES` から `STAFF_ROLE.WORKER` を外す。
`src/components/tabs/StaffSettings.jsx:184` の「（廃止・作業日報では使えません）」の表示は、role が `worker` の行がもう無いので消してよい（`STAFF_ROLE.WORKER` の定数は `NoPermissionScreen.jsx` の作業員の入口で使うので残す）。

**巻き戻し**: `office_staff_role_check` を `worker` 入りに戻し、`_effective_worker` を `20261107020000:198-215` の定義で作り直す。

### 4.2 DB-1: 作業員が `TaskRecords` と休憩設定を直接書き換えられる

**問題**: §2.2 のとおり、`TaskRecords` と `WorkerDailyBreakSettings` は worker に FOR ALL を許し、行も絞っていない。
作業員の個人アカウントでも、REST で他人の行を UPDATE / DELETE できる（RPC の本人の固定を素通りする）。

**方針**: 作業員の個人アカウントからの書き込みは、RPC（`save_daily_report` / `delete_worker_project_day` / `save_worker_day_leave`。どれも SECURITY DEFINER）だけにする。
画面で直接書いている 2 か所（休憩設定の upsert、日報削除の予備）を先に RPC に寄せ（M2・F1）、その後で RLS を絞る（M3）。

休憩設定は、旧画面（PWA のキャッシュ）が直接 upsert し続けるので、M3 では「本人の行だけ書ける」仮のポリシーを残し、M4 で外す。

**SQL 案（M3）**:

```sql
-- ---------- TaskRecords ----------
DROP POLICY IF EXISTS "task_records_staff_all" ON public."TaskRecords";

CREATE POLICY "task_records_office_all" ON public."TaskRecords"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

-- 作業員は読むだけ（範囲は DB-2）
CREATE POLICY "task_records_select_worker" ON public."TaskRecords"
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_personal_worker())
    AND (
      btrim(worker_name) = (SELECT public.current_worker_name())
      OR project_id = ANY ((SELECT public.my_foreman_project_ids()))
    )
  );

-- ---------- WorkerDailyBreakSettings ----------
DROP POLICY IF EXISTS "worker_daily_break_settings_staff_all" ON public."WorkerDailyBreakSettings";

CREATE POLICY "worker_daily_break_settings_office_all" ON public."WorkerDailyBreakSettings"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

CREATE POLICY "worker_daily_break_settings_select_own" ON public."WorkerDailyBreakSettings"
  FOR SELECT TO authenticated
  USING ((SELECT public.is_personal_worker())
         AND btrim(worker_name) = (SELECT public.current_worker_name()));

-- 仮: 旧画面の直接 upsert のため、本人の行だけ書けるようにしておく（M4 で消す）
CREATE POLICY "worker_daily_break_settings_insert_own_tmp" ON public."WorkerDailyBreakSettings"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_personal_worker())
              AND btrim(worker_name) = (SELECT public.current_worker_name()));
CREATE POLICY "worker_daily_break_settings_update_own_tmp" ON public."WorkerDailyBreakSettings"
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_personal_worker())
         AND btrim(worker_name) = (SELECT public.current_worker_name()))
  WITH CHECK ((SELECT public.is_personal_worker())
              AND btrim(worker_name) = (SELECT public.current_worker_name()));
```

`task_records_office_all` は既存のポリシーと同じ書き方（`is_admin() OR current_staff_role() = 'office'`）にそろえる。
担当者兼作業員は担当者として扱われるので、代理入力・管理画面とも今までどおり書ける。

**フロント**（F1）:
- `src/hooks/useDailyReport.js:214-218` の `TaskRecords` 直接削除の予備を消す（`delete_worker_project_day` は本番にある前提。§7.1 で確かめる）。
- 休憩設定の保存は §4.7（DB-7）で RPC に入れる。`saveWorkerDailyBreakSettings` は「RPC が `break_saved` を返さなかったとき（旧 DB）」の予備としてだけ呼び、M4 の後の F2 で消す。

**影響**: 管理画面（`InputTab` = `useProjects.js:428-466`、`DailyReportTab`、配置表、人工集計）は担当者のログインなので変わらない。
作業員画面の書き込みはすべて RPC なので、F1 の後は変わらない。旧画面の休憩設定の保存は、本人の行なら M4 まで通る。

**残る制約**: 行の持ち主を `worker_name`（文字列）で見ているので、作業員の名前を変えると、過去の行は本人から見えなくなる（RPC でも同じ。今と変わらない）。
`worker_id` で持つかは `worker-login.md` §8 の宿題のまま。

**巻き戻し**: 追加したポリシーを消し、`task_records_staff_all`（`20260710002406:13-16`）と `worker_daily_break_settings_staff_all`（`20260930000000:14-18`）を元の SQL で作り直す。

### 4.3 DB-2: 作業員が全員分の日報と承認申請を読める

**問題**: `TaskRecords` は FOR ALL（行の絞り込みなし）、承認 2 表は `*_select_worker` が `current_staff_role() = 'worker'` だけで全行を許す。
作業員の個人アカウントで、全員の作業時間・残業時間・残業理由・作業手当を読める。

**方針**: 作業員が読めるのは「自分の行」と「自分が職長の現場の行」だけにする（`worker-login.md` §8 の「本人＋担当工事の職長＋office 以上」）。
画面のうち、他人の行を読んでいるのは次の 3 つ:

| 読み方 | 誰が | 絞った後 |
|---|---|---|
| 職長の進捗確認（`fetchAllProjectRecordsResult`、`WorkerApp.jsx:419-422`） | 職長だけ | 職長の現場なので読める |
| 承認一覧と作業手当の時間（`fetchPendingApprovals` / `fetchPendingWorkAllowanceApprovals`） | 職長だけ | 職長の現場なので読める |
| 作業員画面の配置表の「実績あり」（`useWorkerAssignments.js:56-58`） | 作業員全員 | **読めなくなる** → RPC に変える |

配置表の実績は「誰がいつどの現場に出たか」だけを使っている（`useWorkerAssignments.js:98-113` で `worker_name` と `date` から `project_id` の集合を作るだけ。`id` は使っていない）。
配置そのもの（`Assignments`）は作業員にも見えているので、時間・残業・メモを含まない「出た現場」だけを返す RPC にする。

**SQL 案（M2 で RPC を足し、M3 でポリシーを絞る）**:

```sql
-- M2: 配置表用。期間内に日報がある（作業員名・日付・現場）の組だけを返す。時間・メモは返さない
CREATE OR REPLACE FUNCTION public.get_task_record_presence(p_start date, p_end date)
RETURNS TABLE (project_id bigint, worker_name text, date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_office_or_admin() OR public.is_personal_worker()) THEN
    RAISE EXCEPTION '実績を参照する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 62 THEN
    RAISE EXCEPTION '期間の指定が不正です。' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT DISTINCT t.project_id, t.worker_name, t.date
      FROM "TaskRecords" t
     WHERE t.date BETWEEN p_start AND p_end;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_task_record_presence(date, date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_task_record_presence(date, date) TO authenticated;
```

（作業員の配置表は 28 日分 = `useWorkerAssignments.js:10` の `TOTAL_DAYS`。上限の 62 日はそれより十分大きくとる。）

```sql
-- M3: TaskRecords の作業員の SELECT は §4.2 の task_records_select_worker（本人 + 職長の現場）

-- M3: 承認申請
DROP POLICY IF EXISTS "overtime_approvals_select_worker" ON public."OvertimeApprovals";
CREATE POLICY "overtime_approvals_select_worker" ON public."OvertimeApprovals"
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_personal_worker())
    AND (
      btrim(worker_name) = (SELECT public.current_worker_name())
      OR project_id = ANY ((SELECT public.my_foreman_project_ids()))
    )
  );

DROP POLICY IF EXISTS "work_allowance_approvals_select_worker" ON public."WorkAllowanceApprovals";
CREATE POLICY "work_allowance_approvals_select_worker" ON public."WorkAllowanceApprovals"
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_personal_worker())
    AND (
      btrim(worker_name) = (SELECT public.current_worker_name())
      OR project_id = ANY ((SELECT public.my_foreman_project_ids()))
    )
  );
```

**フロント**（F1）: `useWorkerAssignments.js:56-58` を `supabase.rpc('get_task_record_presence', { p_start: startStr, p_end: actualEnd })` に変える。
RPC が無い DB（`PGRST202`）では今のクエリに戻す（`useDailyReport.js` の `isMissingRpcError` と同じ作り）。
キャッシュのキー `worker-chart-actuals` は形が同じ（`project_id, worker_name, date`）なのでそのままでよい。
新しい関数は CLAUDE.md の規約どおり `src/hooks/useDailyReport.js`（または `useWorkerAssignments.js` の中）に置き、画面から `supabase.rpc` を直接呼ばない。

**影響**: 担当者の代理入力（`?workerId=`）は担当者のログインなので全件読める。担当者兼作業員も同じ。
職長は自分の現場の全員分を読める（今と同じ）。職長でない作業員は、他の人の行が見えなくなる（画面で使っていないので表示は変わらない）。

**巻き戻し**: 承認 2 表の `*_select_worker` を `20260710002406:61-64, 71-74` の元の SQL で作り直す。`get_task_record_presence` は残しておいてよい。

### 4.4 DB-4: `save_daily_report` の削除と更新が、現場・日付で絞られていない

**問題**: `save_daily_report`（`20261107020000:271-305`）の DELETE と UPDATE は `worker_name = v_worker` と id だけで絞っている。
画面に別の日・別の現場の `record_id` が残ったまま送られると（F0-2・F0-3）、その日の行が書き換わる・消える。
更新の対象が見つからなければ `fallback_insert` で追加し直すので、取り違えた内容がそのまま残る。

**画面の送り方（`WorkerApp.jsx:1270-1338`）**:
- `delete_ids` は選んでいる現場の行だけ。
- `updates` には、選んでいる現場の行（全項目、`fallback_insert` 付き）と、**休憩の再計算で時間が変わる同じ日の他の現場の行**（`hours` と `overtime_hours` だけ、`fallback_insert` なし。1334-1337）が入る。

そのため、更新は一律に現場で絞れない。次のように分ける。

| 操作 | 絞り込み |
|---|---|
| DELETE（`delete_ids`） | `worker_name = v_worker AND project_id = v_project AND date = v_date` |
| 開始時刻を外す UPDATE（一意索引対策） | 同上 |
| UPDATE（`updates[]`）のうち、`fallback_insert` があるか、`hours` / `overtime_hours` / `early_overtime_hours` 以外のキーを含むもの | 同上（選んでいる現場の行だけ） |
| UPDATE のうち、上記以外（休憩の再計算） | `worker_name = v_worker AND date = v_date`（同じ日なら他の現場も可） |

対象の行が「ある」のに絞り込みで外れた（別の日・別の現場の行だった）ときは、`fallback_insert` で追加し直さず、**保存全体を取り消して**「画面が古い」と返す。
行そのものが無いとき（消された）は、読んだときの版が送られていれば §4.5 の楽観ロックで競合として止める（Q1）。版が無い旧画面だけ、M4 までは今のまま `fallback_insert` で追加し直す。

**SQL 案（M2。`save_daily_report` の該当部分。全体は §4.5 とまとめて差し替える）**:

```sql
  -- 削除（この作業員・この現場・この日の日報に限る）
  DELETE FROM public."TaskRecords"
   WHERE worker_name = v_worker
     AND project_id = v_project
     AND date = v_date
     AND id IN (SELECT x::bigint FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x);

  -- 開始時刻を書き換える行は、先に開始時刻を外しておく（一意索引 task_records_worker_slot_key 対策）
  UPDATE public."TaskRecords" t
     SET start_time = NULL
   WHERE t.worker_name = v_worker
     AND t.project_id = v_project
     AND t.date = v_date
     AND t.id IN (
       SELECT (u->>'id')::bigint
         FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) u
        WHERE COALESCE(u->'data', '{}'::jsonb) ? 'start_time'
     );

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) LOOP
    v_data := COALESCE(v_row->'data', '{}'::jsonb);
    -- 休憩の再計算（時間だけの書き換え）なら、同じ日の他の現場の行も対象にする
    v_recalc_only := NOT (v_row ? 'fallback_insert')
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_data) k
         WHERE k NOT IN ('hours', 'overtime_hours', 'early_overtime_hours')
      );

    UPDATE public."TaskRecords" t SET
      -- （SET の中身は 20261107020000:290-296 と同じ）
      ...
    WHERE t.id = (v_row->>'id')::bigint
      AND t.worker_name = v_worker
      AND t.date = v_date
      AND (t.project_id = v_project OR v_recalc_only);
    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count = 0 THEN
      IF EXISTS (SELECT 1 FROM public."TaskRecords" t
                  WHERE t.id = (v_row->>'id')::bigint AND t.worker_name = v_worker) THEN
        -- 行はあるが別の日・別の現場（画面に古い入力が残っている）。何も保存しない
        RAISE EXCEPTION '別の日か別の現場の日報を書き換えようとしました。画面を読み込み直してから送信してください。'
          USING ERRCODE = '22023', DETAIL = format('record_id=%s', v_row->>'id');
      ELSIF v_row ? 'fallback_insert' THEN
        -- 管理者の削除などで対象が消えていた。版が送られていれば §4.5 の事前確認で止まっているので、ここに来るのは旧画面だけ
        v_new_id := public._upsert_task_record(v_row->'fallback_insert', v_project, v_date, v_worker);
        v_remapped := v_remapped || jsonb_build_object('old_id', (v_row->>'id')::bigint, 'new_id', v_new_id);
      END IF;
    END IF;
  END LOOP;
```

あわせて、作業員を決められなかったとき（DB-3 の後の閲覧者など）の文言を直す:

```sql
  IF v_worker IS NULL THEN
    RAISE EXCEPTION '日報を保存する権限がありません。' USING ERRCODE = '42501';
  END IF;
  IF v_project IS NULL OR v_date IS NULL THEN
    RAISE EXCEPTION '日報の保存内容が不正です。' USING ERRCODE = '22023';
  END IF;
```

**フロント**（F1）: `22023` で「画面を読み込み直して」が返ったら、下書きを残したまま `showToast(…, 'error')` で知らせ、その現場・日付を読み直す。
画面側の根本の対策は F0-2・F0-3（`worker-daily-report-refactor.md` §4）。DB の絞り込みは「画面に不具合が残っていても他の日を壊さない」ための二重の守り。

**巻き戻し**: `save_daily_report` を `20261107020000:237-384` の定義で作り直す（§4.5〜4.7 とまとめて 1 つの関数なので、M2 の巻き戻しは関数ごと）。

### 4.5 DB-5: 楽観ロックが無く、最後に送った人の内容で上書きされる

**問題**: 作業員が画面を開いた後に、管理者が `InputTab` で時間を直したり、職長の進捗を直したりしても、作業員が送ると画面に残っていた古い値で上書きされる。
`save_daily_report` の UPDATE（`20261107020000:287-305`）も進捗の UPDATE（322-325）も、読んだときの値を見ていない。
作業員画面は職長でなくても、進捗を全工種ぶん毎回送っている（`WorkerApp.jsx:1380-1382` は職長のときだけ送るが、職長は全工種の値を送る）。

**方針**:
1. `TaskRecords` に `updated_at` を足し、UPDATE のたびにトリガーで `now()` を入れる（管理画面の直接 UPDATE も含む）。
2. 画面は、読み込んだ行の `updated_at` を `expected_versions`（`{ "<record_id>": "<updated_at>" }`）で送る。`updates[]` と `delete_ids` の形は変えない（旧画面・下書きのため）。
3. RPC は、書き込みの前に対象の行をロックして版を比べ、1 行でも違えば **何も保存せずに** 競合を返す。
4. 進捗は、変えた工種だけを、読んだときの値（`expected_progress`）と一緒に送る。DB の値が違えば競合。
5. 保存後の版（その作業員・その日の全行の `updated_at`）を返し、画面は次の送信に使う。

`expected_versions` が無い送信（旧画面・古い下書き）は、M4 までは今までどおり比べずに保存する。

**SQL 案（M2）**:

```sql
-- 列とトリガー
ALTER TABLE public."TaskRecords"
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN public."TaskRecords".updated_at IS
  '最後に更新した日時（楽観ロック用。UPDATE のたびにトリガーで入れる）';

CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._touch_updated_at() FROM anon, PUBLIC, authenticated;

DROP TRIGGER IF EXISTS task_records_touch_updated_at ON public."TaskRecords";
CREATE TRIGGER task_records_touch_updated_at
  BEFORE UPDATE ON public."TaskRecords"
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
```

`now()` は STABLE なので、既存の行への列の追加は書き換えを伴わない（PostgreSQL 11 以降の fast default）。既存の行の `updated_at` はマイグレーションの時刻になる。

```sql
-- save_daily_report の中、削除・更新より前に置く
  -- 楽観ロック: 触る行をロックしてから、画面が読んだときの版と比べる
  PERFORM 1 FROM public."TaskRecords" t
   WHERE t.worker_name = v_worker
     AND t.id IN (
       SELECT x::bigint FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x
       UNION
       SELECT (u->>'id')::bigint FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) u
     )
   FOR UPDATE;

  IF jsonb_typeof(p_payload->'expected_versions') = 'object' THEN
    WITH touched AS (
      SELECT x::bigint AS id, false AS is_update
        FROM jsonb_array_elements_text(COALESCE(p_payload->'delete_ids', '[]'::jsonb)) x
      UNION ALL
      SELECT (u->>'id')::bigint, true
        FROM jsonb_array_elements(COALESCE(p_payload->'updates', '[]'::jsonb)) u
    ), expected AS (
      SELECT t.id, bool_or(t.is_update) AS is_update,
             (p_payload->'expected_versions'->>t.id::text)::timestamptz AS v
        FROM touched t
       WHERE p_payload->'expected_versions' ? t.id::text
       GROUP BY t.id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind', 'task_record',
             'id', e.id,
             'reason', CASE WHEN r.id IS NULL THEN 'deleted' ELSE 'updated' END,
             'current_updated_at', r.updated_at)), '[]'::jsonb)
      INTO v_conflicts
      FROM expected e
      LEFT JOIN public."TaskRecords" r ON r.id = e.id AND r.worker_name = v_worker
     -- 消そうとした行が既に無いのは競合にしない（結果は同じ）。更新しようとした行が無いのは競合（Q1）
     WHERE (r.id IS NULL AND e.is_update)
        OR (r.id IS NOT NULL AND r.updated_at IS DISTINCT FROM e.v);
  END IF;

  -- 進捗: 読んだときの値が送られていれば比べる
  SELECT v_conflicts || COALESCE(jsonb_agg(jsonb_build_object(
           'kind', 'progress', 'id', pt.id,
           'reason', 'updated', 'current', pt.progress_percentage)), '[]'::jsonb)
    INTO v_conflicts
    FROM jsonb_array_elements(COALESCE(p_payload->'progress', '[]'::jsonb)) x
    JOIN public."ProjectTasks" pt ON pt.id = (x->>'id')::bigint AND pt."projectId" = v_project
   WHERE x ? 'expected_progress'
     AND pt.progress_percentage IS DISTINCT FROM NULLIF(x->>'expected_progress', '')::bigint;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    -- PT409: PostgREST が HTTP 409 で返す（独自の SQLSTATE）。DETAIL に競合した行を入れる
    RAISE EXCEPTION '他の人が先にこの日報か進捗を直しました。読み込み直してから、もう一度入力してください。'
      USING ERRCODE = 'PT409', DETAIL = v_conflicts::text;
  END IF;
```

`DECLARE` に `v_conflicts jsonb := '[]'::jsonb;` と `v_recalc_only boolean;`（§4.4）を足す。
`PT409` は PostgREST の「SQLSTATE が `PT` + 3 桁なら、その HTTP ステータスで返す」仕組みを使う。supabase-js では `error.code === 'PT409'` で見分けられる見込みだが、
本番の PostgREST のバージョンで返り方を実装のときに確かめる（だめなら `P0001` と `HINT = 'stale_daily_report'` で見分ける）。
楽観ロックの確認で使う版は「画面が読んだときの値」なので、確認の後で同じ関数の UPDATE がトリガーで `updated_at` を進めても問題ない（確認は書き込みより前に 1 回だけ行う）。
`FOR UPDATE` で行をロックしているので、確認から書き込みまでの間に管理者が同じ行を書き換えることはない。

戻り値に版を足す:

```sql
  RETURN jsonb_build_object(
    'inserted_ids', v_inserted,
    'remapped', v_remapped,
    'approval_sync_failed', v_approval_failed,
    'break_saved', v_break_saved,  -- §4.7
    -- 保存後の版（この作業員・この日の全現場の行）。画面は次の送信の expected_versions に使う
    'versions', (SELECT COALESCE(jsonb_object_agg(t.id, t.updated_at), '{}'::jsonb)
                   FROM public."TaskRecords" t
                  WHERE t.worker_name = v_worker AND t.date = v_date)
  );
```

**フロント**（F1）:
- 日報を読み込んだときに、行の `updated_at` を時間枠（slot）に持たせる。読み込みは `select('*')` なので列が増えれば届く。
- `handleSubmit`（`WorkerApp.jsx:1374-1391`）で `expected_versions` を作って送る。休憩の再計算で更新する他の現場の行（1334-1337）も、`workerDailyAllRecords` の `updated_at` を入れる。
- 端末のキャッシュ（`fromCache`）から読んだ行は版が古い可能性が高いが、それも送る（古ければ競合で止まるのが正しい）。
- 進捗は、読み込んだ値と違う工種だけを `{ id, progress_percentage, expected_progress }` で送る（今は全工種を送っている）。
- `PT409` が返ったら、下書きを残したまま `showToast('他の人が先に直しました。読み込み直してから入力してください', 'error')` を出し、その現場・日付を読み直す。`details` の `kind` / `reason` で「消されていた」「直されていた」を出し分ける。
- 保存後は戻り値の `versions` で各行の版を更新する（今は送信後に `fetchWorkerDailyRecords` で取り直しているが、その取り直しに失敗しても版がずれないように）。
- 下書き（localStorage）の slot に `updated_at` を足すのは「キーを足すだけ」で、既存の下書きはそのまま読める（`worker-daily-report-refactor.md` §1「端末の保存形式は変えない」の範囲。版の無い古い下書きは比べずに送る）。

**残る制約**:
- 追加（`inserts`）の再送は、一意索引で同じ時間枠の行を UPDATE する（`_upsert_task_record`）。そこで管理者の修正を上書きしうるのは今と同じ。時間枠ごとの UUID（DB-10）で直す。
- 協力業者（`subcontractor_updates`）にも同じ上書きがあるが、今回は対象外（§10）。
- 管理画面（`InputTab`）の直接 UPDATE は版を比べない（担当者どうしの上書きは今と同じ）。

**巻き戻し**: `save_daily_report` を `20261107020000` 版に戻す。`updated_at` 列とトリガーは残してよい（使う側が無くなるだけ）。消すなら
`DROP TRIGGER task_records_touch_updated_at ON public."TaskRecords"; DROP FUNCTION public._touch_updated_at(); ALTER TABLE public."TaskRecords" DROP COLUMN updated_at;`。

### 4.6 DB-6: 承認の RPC が「職長が画面で見た値」を受け取らない

**問題**: `approve_overtime` / `approve_work_allowance`（`20261107020000:485-493, 525-532`）は、承認の時点の `requested_hours` / `task_names` をそのまま承認値にする。
職長が一覧を開いた後に作業員が時間を直して送ると、職長は見ていない時間を承認することになる。

**方針**: 画面で見た値を引数で受け取り、DB の値と違えば承認しない。

| RPC | 追加する引数 | 比べるもの |
|---|---|---|
| `approve_overtime` | `p_expected_hours numeric DEFAULT NULL`、`p_expected_updated_at timestamptz DEFAULT NULL` | `requested_hours`（残業の時間）と `updated_at`（理由の書き換えも含めて検知） |
| `approve_work_allowance` | `p_expected_task_names text[] DEFAULT NULL`、`p_expected_updated_at timestamptz DEFAULT NULL` | `task_names`（並べ替えて比べる）と `updated_at`（工種の時間が変わった保存も `_sync_work_allowance_approval` が `updated_at` を進めるので検知できる） |

引数を足すと関数の識別子（引数の型の並び）が変わる。古い 3 引数版を残すと、PostgREST が 3 引数の呼び出しで候補を決められなくなる（`PGRST203`）ので、**古い版を DROP してから** 新しい版を作る。
足した引数は `DEFAULT NULL` なので、旧画面の `{ p_id, p_approver_name, p_approver_worker_id }` の呼び出しも新しい版に当たる（その場合は比べない。M4 で作業員からの呼び出しには必須にする）。

**SQL 案（M2）**:

```sql
DROP FUNCTION IF EXISTS public.approve_overtime(bigint, text, bigint);

CREATE FUNCTION public.approve_overtime(
  p_id bigint,
  p_approver_name text,
  p_approver_worker_id bigint,
  p_expected_hours numeric DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public."OvertimeApprovals";
  v_worker_id bigint;
  v_worker text;
  v_approver text;
BEGIN
  -- 承認の間に申請が書き換わらないようロックする
  SELECT * INTO v_row FROM public."OvertimeApprovals" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '残業申請が見つかりません。' USING ERRCODE = 'P0002';
  END IF;
  SELECT e.worker_id, e.worker_name INTO v_worker_id, v_worker
    FROM public._effective_worker(p_approver_worker_id, p_approver_name) e;
  IF NOT (public.is_office_or_admin()
          OR (COALESCE(public.current_staff_role() = 'worker', false)
              AND public.is_declared_foreman(v_row.project_id, v_worker_id, v_worker))) THEN
    RAISE EXCEPTION '残業を承認できるのはこの現場の職長のみです。' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'この残業申請は承認待ちではありません。' USING ERRCODE = '22023';
  END IF;
  -- 画面で見た値と違えば承認しない
  IF (p_expected_hours IS NOT NULL AND v_row.requested_hours IS DISTINCT FROM p_expected_hours)
     OR (p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at) THEN
    RAISE EXCEPTION '申請の内容が変わりました（残業 %h）。一覧を読み込み直してから承認してください。', v_row.requested_hours
      USING ERRCODE = 'PT409';
  END IF;
  v_approver := public._approver_name(p_approver_name);

  UPDATE public."OvertimeApprovals"
     SET status = 'approved',
         approved_by = v_approver,
         approved_at = now(),
         approved_hours = requested_hours,
         acknowledged_at = CASE WHEN btrim(worker_name) = btrim(v_approver) THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint, numeric, timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_overtime(bigint, text, bigint, numeric, timestamptz) TO authenticated;
```

`approve_work_allowance` も同じ形にする。比べるところだけ:

```sql
  IF (p_expected_task_names IS NOT NULL
        AND ARRAY(SELECT n FROM unnest(v_row.task_names) n ORDER BY n)
            IS DISTINCT FROM ARRAY(SELECT n FROM unnest(p_expected_task_names) n ORDER BY n))
     OR (p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at) THEN
    RAISE EXCEPTION '申請の内容が変わりました。一覧を読み込み直してから承認してください。' USING ERRCODE = 'PT409';
  END IF;
```

マイグレーションの最後に `NOTIFY pgrst, 'reload schema';` を入れ、PostgREST に新しい関数を知らせる。

**フロント**（F1）:
- `src/lib/overtimeApprovals.js` の `approveOvertime(id, approverName, approverWorkerId)` に、一覧で取った `requested_hours` と `updated_at` を足して渡す（`fetchPendingApprovals` は `select('*')` なので既に持っている）。
- `src/lib/workAllowanceApprovals.js` の `approveWorkAllowance` に `task_names` と `updated_at` を足す。
- `PGRST202`（新しい引数の関数が無い = M2 の前の DB）なら、引数を足さずに呼び直す。
- `PT409` が返ったら `showToast('申請の内容が変わりました。一覧を読み込み直しました', 'error')` を出し、承認一覧を取り直す（`WorkerApp.jsx:497-545` の読み込み）。

**巻き戻し**: 新しい 5 引数版を DROP し、`20261107020000:460-542` の 3 引数版を作り直して `NOTIFY pgrst, 'reload schema';`。
F1 の画面は `PGRST202` で 3 引数に戻すので、巻き戻しても承認は止まらない。

### 4.7 DB-7: 休憩設定を日報の保存と同じトランザクションに入れる

**問題**: 休憩設定は、日報の保存（RPC）が成功した後に別のリクエストで upsert している（`WorkerApp.jsx:1466-1474` → `useDailyReport.js:141-150`）。
後半だけ失敗すると、日報の時間は新しい休憩で計算したのに、休憩設定は古いまま残る。次に別の現場を送ると、古い休憩で他の現場の時間が計算し直される。
また、この直接 upsert が DB-1 の穴（作業員が休憩設定を直接書ける）を必要にしている。

**方針**: `save_daily_report` の payload に `break_durations` を足し、日報と同じトランザクションで upsert する。
キーが無ければ休憩設定には触らない（旧画面）。戻り値の `break_saved` が true でなければ、画面は今までどおり直接 upsert する（旧 DB）。

**SQL 案（M2。`save_daily_report` の中、日報の追加の後・進捗の前に置く）**:

```sql
  -- 休憩設定（作業員・日付単位）。キーがあるときだけ保存する
  IF p_payload ? 'break_durations' THEN
    v_breaks := p_payload->'break_durations';
    IF jsonb_typeof(v_breaks) <> 'array'
       OR jsonb_array_length(v_breaks) > 3
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_breaks) b
          WHERE jsonb_typeof(b) <> 'number' OR (b #>> '{}')::numeric NOT BETWEEN 0 AND 180
       ) THEN
      RAISE EXCEPTION '休憩設定の内容が不正です。' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public."WorkerDailyBreakSettings" AS b (worker_name, date, break_durations, updated_at)
    VALUES (v_worker, v_date, v_breaks, now())
    ON CONFLICT (worker_name, date) DO UPDATE SET
      break_durations = EXCLUDED.break_durations,
      updated_at = now();
    v_break_saved := true;
  END IF;
```

`DECLARE` に `v_breaks jsonb;` と `v_break_saved boolean := false;` を足す。
値の範囲（3 つまで・0〜180 分）は、画面の休憩の選択肢（`effectiveBreakDurations`、10 時・昼・15 時の 3 つ）より広くとる。実装のときに画面の選択肢の最大値を確かめて狭めてよい。

**フロント**（F1）:
- `handleSubmit` で `break_durations: effectiveBreakDurations` を payload に入れる。
- `saveDailyReport`（`useDailyReport.js:236-247`）の戻り値に `breakSaved: data?.break_saved === true` と `versions` を足す。
- `WorkerApp.jsx:1466-1474` の別リクエストは、`breakSaved` が false のときだけ行う（M4 の後の F2 で消す）。
- 休憩設定が読み込めていないときに送らない（F0-8）のは画面側の修正のまま。

**本番での確かめ方**: 同じトランザクションの `now()` は同じ値なので、RPC で保存した休憩設定は、同じ作業員・同じ日の `TaskRecords.updated_at` のどれかと一致する。
一致しない保存が続いていれば、旧画面が残っている（§7.3）。

**巻き戻し**: `save_daily_report` を戻せば `break_durations` は無視される。F1 の画面は `break_saved` が無いので直接 upsert に戻る（M3 の仮ポリシーで本人の行は書ける）。

### 4.8 DB-9: 作業員と閲覧者に `Projects` の金額の列を見せない

**問題**: `projects_select_worker_viewer`（`20260710002254:9-11`）で、作業員と閲覧者は `Projects` の全列を読める。
作業員画面は `select('*')`（`useDailyReport.js:35-36`）で読み、端末の localStorage にもキャッシュしている（`WorkerApp.jsx:216` の `fetchWithCache('projects', …)`）。
`security-permissions.md` は `Projects` を「高（経営情報）」に分類している。

**列単位の権限を使わない理由**: アプリのロール（admin / office / worker / viewer）は、DB ではすべて同じ `authenticated` ロールで動く。
`REVOKE SELECT ("estimatedAmount") ON "Projects" FROM authenticated` にすると、担当者の管理画面（`useSupabaseData.js:52` の `select('*')` など）まで読めなくなる。
ロールごとに列を分けるには DB のロールを分ける必要があり、Supabase の認証の作りから外れる。

**方針**: `workers_directory`（`20260710005126`、`20261107020000:153-156`）と同じく、安全な列だけを出すビューを作る。
ビューは `security_invoker` を指定しない（作成者の権限で基表を読む）ので、ビュー側の WHERE で認可する。その後で、作業員・閲覧者の基表の SELECT を外す。

画面が使っている列（`grep` で確認）:

| 使う画面 | 列 |
|---|---|
| 作業員画面（`WorkerApp.jsx`、`useWorkerAssignments.js`、`useWeeklyReportData.js`、`scheduleDisplay.js`） | `id`, `name`, `short_name`, `status`, `foreman_worker_id`, `startDate`, `endDate`, `bar_color`, `display_order`, `created_at` |
| 工程表（`useScheduleViewData.js:9`） | `id, name, short_name, startDate, endDate, bar_color, status, display_order, created_at` |

**SQL 案**:

```sql
-- M2: 現場の名簿ビュー（金額・顧客・PDF の列を含めない）
CREATE OR REPLACE VIEW public.projects_directory AS
  SELECT id, created_at, name, short_name, status, "startDate", "endDate",
         foreman_worker_id, bar_color, display_order, "order", show_on_home
    FROM public."Projects"
   WHERE public.is_staff() OR public.is_personal_worker();

REVOKE ALL ON public.projects_directory FROM anon, PUBLIC;
GRANT SELECT ON public.projects_directory TO authenticated;

-- M3: 作業員・閲覧者は基表を読めなくする
DROP POLICY IF EXISTS "projects_select_worker_viewer" ON public."Projects";
```

`is_staff()` は担当者の行があれば真なので、閲覧者（`office_staff.role = 'viewer'`）も読める。退職者・ロールの無いログインは 0 件。
`is_prime_contractor` と `assignment_target_ninku` は金額ではないが、作業員画面で使っていないので出さない（要るようになったら足す）。

基表の SELECT を外した後も動くもの:
- `my_foreman_project_ids()` / `is_project_foreman()` / `add_project_task()` / `get_public_schedule()` など、`Projects` を読む SECURITY DEFINER の関数（§7.2 のクエリで、SECURITY DEFINER でない関数が `Projects` を読んでいないかを確かめる）。
- 共有リンクの工程表（`get_public_schedule`、未ログイン）。

**フロント**（F1）:
- `src/hooks/useDailyReport.js:35-36` の `fetchProjectsResult` を `supabase.from('projects_directory').select('*')` に変える。ビューが無い（`42P01` / `PGRST205`）ときは今の `Projects` に戻す。
- **端末のキャッシュを消す**: `WorkerApp.jsx:216` のキャッシュのキーを `projects-directory` に変え、起動時に古いキー `projects` の localStorage を消す（金額入りの行が作業員の端末に残っているため）。キャッシュのキーの組み立ては `src/utils/offlineCache.js` を確かめて合わせる。
- `src/hooks/useScheduleViewData.js:20, 35` の `from('Projects')` を `from('projects_directory')` に変える（担当者で開いたときもビューで足りる）。

**巻き戻し**: `projects_select_worker_viewer` を `20260710002254:9-11` の元の SQL で作り直す。ビューは残してよい。

---

## 5. まとめた差し替え: `save_daily_report` の M2 版

§4.4（DB-4）・§4.5（DB-5）・§4.7（DB-7）は同じ関数の中の変更なので、M2 で `save_daily_report` を 1 回で差し替える。処理の順番:

1. 権限・作業員の決定（DB-3 の後の文言。§4.4）
2. 職長の判定（今と同じ）
3. **楽観ロック**: 触る行の `FOR UPDATE` → `expected_versions` と `expected_progress` の確認 → 競合があれば `PT409`（§4.5）
4. DELETE（現場・日付で絞る。§4.4）
5. 開始時刻を外す UPDATE（現場・日付で絞る）
6. UPDATE のループ（現場・日付で絞る。行はあるのに外れたら `22023`。§4.4）
7. INSERT（今と同じ）
8. **休憩設定**（§4.7）
9. 進捗・協力業者（職長のみ。進捗は送られた工種だけ。今と同じ SQL）
10. 承認申請の同期（今と同じ）
11. 戻り値に `break_saved` と `versions` を足す

引数は `p_payload jsonb` のままなので、関数の識別子は変わらない（`CREATE OR REPLACE` でよい。`REVOKE` / `GRANT` も今と同じ）。
旧画面の payload（`expected_versions` / `break_durations` / `expected_progress` が無い）は、4〜6 の絞り込み以外は今と同じに動く。

### 5.1 実装で §4 の SQL 案から変えた点（2026-11-20、M2）

正はマイグレーション `20261120010000_daily_report_rpc_v2.sql`。

- 作業員を決められないとき: 担当者（代理入力で作業員名が空）は `22023`「保存内容が不正」、それ以外は `42501`「権限がありません」に分けた。
- 進捗の楽観ロック（`expected_progress`）は職長のときだけ確かめる。職長でない作業員が進捗を送ったときは、競合（`PT409`）ではなく従来どおり `42501`「職長のみ」になる。
- 休憩設定の検査は、配列かどうかを先に別の `IF` で確かめ、要素の数値の変換は `CASE` で囲んだ（`OR` の評価順に頼ると、配列でない値や文字列の要素で、検査の前に型のエラーになりうるため）。
- 承認の RPC は、申請の行を `FOR UPDATE` で読んでから、職長の判定・承認待ちかどうか・見た値の比較の順に確かめる。5 引数版は `CREATE OR REPLACE` にして、マイグレーションを流し直せるようにした。
- 競合の一覧（`DETAIL`）は id の順に並べる。

---

## 6. 本番に入れる順序と巻き戻し

PWA のキャッシュで古い画面が残るので、どの段階でも「1 つ前の画面」が動くようにする。

| 順 | 内容 | ファイル（案） | 入れる前に確かめること | この段階で旧画面に起きること | 巻き戻し |
|---|---|---|---|---|---|
| 0 | 本番の現状の確認 | — | §7.1 のクエリがマイグレーションと一致すること。一致しなければ設計を見直す | — | — |
| M1 | DB-3: role の CHECK と `_effective_worker` | `20261120000000_close_shared_worker_account.sql`（実装済み） | `office_staff` に role = `worker` の行が 0 件 | 変わらない（共有アカウントはもう無い） | §4.1 |
| M2 | 互換のある追加: `TaskRecords.updated_at` とトリガー、§3 の部品、`get_task_record_presence`、`projects_directory`、`save_daily_report` の差し替え（§5）、`approve_*` の引数追加（§4.6） | `20261120010000_daily_report_rpc_v2.sql`（実装済み） | M1 が入っていること | 別の日・別の現場の行を書き換える送信が `22023` で止まる（F0-2・F0-3 の被害が止まる） | 関数を `20261107020000` 版に戻す。追加したビュー・関数・列は残してよい |
| F1 | 画面: 版・休憩・見た値を送る、presence RPC とビューを使う、予備の直接書き込みを「RPC が無いときだけ」にする、`SHARED_ROLES` の修正（M1 で実施済み） | 実装済み（§6.3） | M2 が本番にあること（§7.2）。ただし F1 は M2 が無くても動くように作る | — | 前の画面に戻す（M2 は旧画面でも動く） |
| 待つ | 旧画面が残っていないかを見る（目安 2 週間、Q2） | — | §7.3 のクエリで旧画面からの保存が 0 件になったこと。作業員に画面の再読み込みを頼む | — | — |
| M3 | RLS を絞る: DB-1（§4.2）、DB-2（§4.3）、DB-9（§4.8）。休憩設定の本人の行への書き込みは仮に残す | `2026xxxx020000_daily_report_rls_tighten.sql` | F1 が出ていること | 配置表の「実績あり」が出なくなる（旧画面は全員分の `TaskRecords` を直接読むため）。`Projects` の基表が 0 件になるので、**現場一覧が空になる**（§6.1） | 元のポリシーを作り直す（§4.2・4.3・4.8） |
| M4 | 必須化: 作業員からの `save_daily_report` に `expected_versions` と `break_durations` を、`approve_*` に見た値を必須にする。休憩設定の仮ポリシーを消す | `2026xxxx030000_daily_report_enforce.sql` | M3 から 1 週間、問い合わせが無いこと | 旧画面からの保存・承認が止まる | 関数を M2 版に戻し、仮ポリシーを作り直す |
| F2 | 画面: 予備の直接書き込み・`PGRST202` での呼び直しを消す | — | M4 が本番にあること | — | 前の画面に戻す |

### 6.1 M3 で旧画面の現場一覧が空になる件

旧画面は `Projects` の基表を読むので、M3 の後は 0 件になり、作業員画面で現場を選べなくなる（キャッシュがあればキャッシュで動く）。
M3 を「待つ」の後に置くのはこのため。それでも残った端末には、管理者から「画面を開き直して（PWA を再読み込みして）」と伝える。
DB-9 のポリシーの削除だけを M4 に回す案もあったが、金額の列が見える期間が延びるので採らず、M3 で削除する（Q5）。

### 6.2 マイグレーションの書き方

- 各ファイルの冒頭に【問題】【対処】を書く（既存の `20261105010000` などと同じ形）。
- `CREATE POLICY` の前に `DROP POLICY IF EXISTS`、関数の識別子が変わるものは `DROP FUNCTION IF EXISTS` してから `CREATE`。
- 関数を変えたら最後に `NOTIFY pgrst, 'reload schema';`。
- 本番への適用は Supabase の SQL エディタか `supabase db push`（今までの運用に合わせる）。適用の前後で §7 のクエリを流し、結果を `docs/handoff/` か PR に残す。


### 6.3 F1 の実装（2026-11-20）と §4 から変えた点

変えたファイル: `src/WorkerApp.jsx`、`src/hooks/useDailyReport.js`・`useWorkerAssignments.js`・`useScheduleViewData.js`、
`src/lib/overtimeApprovals.js`・`workAllowanceApprovals.js`、`src/utils/dailyReportSave.js`（＋テスト）、`src/utils/supabaseErrors.js`（新規、＋テスト）。

- **版の持ち方**: §4.5 では「下書きの slot に `updated_at` を持たせる」としたが、`WorkerApp.jsx` の `recordVersionsRef`（id → 版）に持つことにした。
  現場の読み込み（この現場の行）・その日の全現場の実績の読み込み（他の現場の行。未登録の行だけ）・保存の戻り値（`versions`）で更新し、
  送信では `buildExpectedVersions` で削除・更新する行の版だけを送る。削除した行の版も残るので、`deleted_record_ids` に版を足さずに済む。
  下書き（localStorage）の形は変えていない。下書きを復元して送るときは、その現場・日付を読み込んだときの版と比べる
  （下書きを作った時点の版ではないので、読み込みより前の他の人の修正は検知できない。今と同じ）。
- **競合のとき**: §4.5 では「その現場・日付を読み直す」としたが、自動では読み直さない。入力中の内容を残したまま
  「日付か現場を選び直すと最新の内容を読み込みます」と知らせる（`cb583c7` の「キャッシュの行が消えていた」ときと同じ案内）。
  自動で読み直すと、作業員が入力した内容が画面から消えるため。
- **進捗**: 読み込んだときの値を作業項目の `saved_progress` に持ち、変えた作業項目だけを `expected_progress` と一緒に送る（`buildProgressPayload`）。
  `saved_progress` を持たない作業項目（古い下書きから復元したもの）は、比べずに送る。
- **承認**: 一覧で取った申請（`requested_hours` / `task_names` / `updated_at`）をそのまま渡す。競合のときは従来どおり一覧を取り直す。
- **現場一覧のキャッシュ**: キーを `projects` から `projects-directory` に変え、起動時に古いキー（金額の列を含む）を消す。
- **DB が古いとき**: ビューが無ければ `Projects`、`get_task_record_presence` や新しい引数の `approve_*` が無ければ従来の呼び方に戻す
  （`src/utils/supabaseErrors.js` の `isMissingRelationError` / `isMissingRpcError`）。`save_daily_report` は新しいキーを無視するだけなので、
  `break_saved` が返らなければ休憩設定を従来どおり別のリクエストで保存する。
- **消したもの**: `deleteProjectDayRecords` の `TaskRecords` 直接削除の予備（本番には 20261105020000 から `delete_worker_project_day` がある。§7.1 で確かめる）。
- **やっていないこと**: `src/types/supabase.ts` の作り直し（本番の DB から生成するため、M2 を本番に入れた後に行う）。
  ブラウザでの動作確認（作業員画面は本番の Supabase へのログインが要る）。§8.2 の手動確認は、M2 を入れた環境で行う。

---

## 7. 本番で確かめるクエリ

どれも読むだけ。SQL エディタで流す。

### 7.1 入れる前（現状がマイグレーションどおりか）

```sql
-- ポリシー
SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('TaskRecords', 'WorkerDailyBreakSettings', 'OvertimeApprovals',
                     'WorkAllowanceApprovals', 'Projects')
 ORDER BY tablename, policyname;
-- 期待: §2.2 の表のとおり（task_records_staff_all / worker_daily_break_settings_staff_all /
--       overtime_approvals_office_all / overtime_approvals_select_worker /
--       work_allowance_approvals_office_all / work_allowance_approvals_select_worker /
--       projects_office_all / projects_select_worker_viewer）

-- 日報まわりの関数（識別子・SECURITY DEFINER・本文の指紋）
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.proconfig,
       md5(pg_get_functiondef(p.oid)) AS body_md5,
       pg_get_functiondef(p.oid) ILIKE '%_effective_worker%' AS uses_effective_worker
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('save_daily_report', 'delete_worker_project_day', 'add_project_task',
                     'approve_overtime', 'approve_work_allowance', 'acknowledge_approvals',
                     '_effective_worker', '_approver_name', 'is_personal_worker',
                     'current_worker_id', 'current_staff_role', 'is_office_or_admin',
                     'save_worker_day_leave', 'get_substitute_holiday_candidates')
 ORDER BY 1, 2;
-- 期待: すべて security_definer = true。approve_* は (p_id bigint, p_approver_name text, p_approver_worker_id bigint) の 1 つだけ。
-- body_md5 はローカルに 20261107020000 までを当てた DB で同じクエリを流した値と比べる

-- _effective_worker の本文（共有アカウントの分岐が残っているか）
SELECT pg_get_functiondef('public._effective_worker(bigint, text)'::regprocedure);

-- 共有アカウント（role = worker の担当者行）が残っていないか
SELECT id, name, role, auth_user_id IS NOT NULL AS has_login
  FROM public.office_staff
 WHERE role = 'worker';
-- 期待: 0 件（worker-login.md では id=18 を 2026-11-09 に削除済み）

-- role の CHECK
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'office_staff_role_check';

-- TaskRecords に updated_at が無いこと・トリガーの一覧
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'TaskRecords' ORDER BY ordinal_position;
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
 WHERE tgrelid = 'public."TaskRecords"'::regclass AND NOT tgisinternal;

-- テーブルの権限（authenticated に何が GRANT されているか）
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'authenticated'
   AND table_schema = 'public'
   AND table_name IN ('TaskRecords', 'WorkerDailyBreakSettings', 'OvertimeApprovals',
                      'WorkAllowanceApprovals', 'Projects')
 ORDER BY 1, 2;
```

### 7.2 入れた後

```sql
-- M1: CHECK に worker が無い / _effective_worker に is_office_or_admin の分岐がある
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'office_staff_role_check';
SELECT pg_get_functiondef('public._effective_worker(bigint, text)'::regprocedure) ILIKE '%ELSIF public.is_office_or_admin()%';

-- M2: 関数が新しくなっている
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
       pg_get_functiondef(p.oid) ILIKE '%expected_versions%'  AS has_optimistic_lock,
       pg_get_functiondef(p.oid) ILIKE '%break_durations%'    AS saves_breaks,
       pg_get_functiondef(p.oid) ILIKE '%AND project_id = v_project%' AS scoped_delete
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('save_daily_report', 'approve_overtime', 'approve_work_allowance',
                     'get_task_record_presence', 'current_worker_name', 'my_foreman_project_ids')
 ORDER BY 1, 2;
-- 期待: approve_* は 5 引数版だけ（3 引数版が残っていない）。get_task_record_presence 等は security_definer = true

-- M2: 実行権限（anon に無く、authenticated にある）
SELECT f, has_function_privilege('anon', f, 'EXECUTE') AS anon,
          has_function_privilege('authenticated', f, 'EXECUTE') AS authenticated
  FROM unnest(ARRAY[
    'public.save_daily_report(jsonb)',
    'public.approve_overtime(bigint, text, bigint, numeric, timestamptz)',
    'public.approve_work_allowance(bigint, text, bigint, text[], timestamptz)',
    'public.get_task_record_presence(date, date)',
    'public.current_worker_name()',
    'public.my_foreman_project_ids()'
  ]) AS f;
-- 内部関数は authenticated にも無いこと
SELECT has_function_privilege('authenticated', 'public._effective_worker(bigint, text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public._touch_updated_at()', 'EXECUTE');

-- M2: ビュー（security_invoker が付いていない = 作成者の権限で読む）
SELECT c.relname, c.reloptions, pg_get_viewdef(c.oid)
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'projects_directory';

-- M3: ポリシー（7.1 と同じクエリ）。期待:
--   TaskRecords: task_records_office_all (ALL), task_records_select_worker (SELECT)
--   WorkerDailyBreakSettings: *_office_all (ALL), *_select_own (SELECT), *_insert_own_tmp (INSERT), *_update_own_tmp (UPDATE)
--   OvertimeApprovals / WorkAllowanceApprovals: *_office_all, *_select_worker（qual に current_worker_name と my_foreman_project_ids）
--   Projects: projects_office_all だけ

-- M3: SECURITY DEFINER でない関数が Projects・TaskRecords を読んでいないか（作業員から呼ばれると 0 件になる）
SELECT p.proname, pg_get_function_identity_arguments(p.oid)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND NOT p.prosecdef
   AND (p.prosrc ILIKE '%"Projects"%' OR p.prosrc ILIKE '%"TaskRecords"%');
-- 期待: トリガー関数（_task_records_set_early_overtime など、行を読むだけのもの）以外が無いこと

-- M3: 作業員になりきって確かめる。
-- BEGIN から ROLLBACK までを必ず 1 回でまとめて流す（途中で止まると postgres の権限のまま残る）。
-- <uuid> は職長でない作業員の個人アカウントの auth.users.id、<他人の行の id> はその人以外の TaskRecords.id
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<uuid>', true);
SELECT set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
SELECT public.is_personal_worker(), public.current_worker_name();
SELECT count(*) AS visible_records,
       count(*) FILTER (WHERE btrim(worker_name) <> public.current_worker_name()) AS others
  FROM public."TaskRecords";                          -- others は職長の現場の分だけ
SELECT count(*) FROM public."Projects";               -- 0
SELECT count(*) FROM public.projects_directory;       -- 現場の数
UPDATE public."TaskRecords" SET note = note WHERE id = <他人の行の id> RETURNING id;  -- 0 行（書けない）
DELETE FROM public."TaskRecords" WHERE id = <他人の行の id> RETURNING id;            -- 0 行
ROLLBACK;
```

### 7.3 旧画面が残っていないか（M3・M4 の前）

```sql
-- RPC（M2 以降）で保存した休憩設定は、同じ作業員・同じ日の TaskRecords.updated_at のどれかと同じ時刻になる。
-- 一致しない保存は、旧画面の直接 upsert（または担当者の代理入力の旧画面）。
SELECT b.worker_name, b.date, b.updated_at
  FROM public."WorkerDailyBreakSettings" b
 WHERE b.updated_at > '<M2 を入れた日時>'::timestamptz
   AND NOT EXISTS (
     SELECT 1 FROM public."TaskRecords" t
      WHERE t.worker_name = b.worker_name AND t.date = b.date AND t.updated_at = b.updated_at
   )
 ORDER BY b.updated_at DESC;
-- 期待: F1 を出してから日が経つにつれて 0 件に近づく。残る作業員には画面の再読み込みを頼む
```

誤検知になる場合が 2 つある。件数が少なければ個別に確かめる。
- その日の日報の行が 0 件のまま休憩だけ保存された（全部の時間枠を消して送ったなど）。
- 保存の後で、管理者がその日の行を全部書き換えた（`updated_at` が進んで一致しなくなる）。

---

## 8. テスト

### 8.1 DB（ローカルの PostgreSQL）

`scripts/test-worker-login-db.py` と `tests/db/worker-login-fixture.sql` と同じ作りで、`scripts/test-daily-report-hardening-db.py` と `tests/db/daily-report-hardening-fixture.sql` を足す
（M1・M2 の分は実装済み。フィクスチャは `test-worker-login-db.py` と同じものに、`20260930000000`（休憩設定のテーブル）と
`tests/db/daily-report-hardening-fixture.sql`（`Projects` の列と RLS、作業項目、作業手当の申請）を足している。
`_upsert_task_record` などの内部関数は `worker-login-fixture.sql` の代用品のまま。
実行: `python scripts/test-daily-report-hardening-db.py --port 55432`。2026-11-20 に 65 件すべて通過。下の表の 1〜17・22〜25 にあたる。18〜21 は M3 で足す）
（別ポートのローカルクラスタに新しい DB を作り、`SET ROLE authenticated` と `request.jwt.claim.sub` でログインを切り替える）。

| # | 確かめること | 期待 |
|---|---|---|
| 1 | M1: role = worker の担当者行を INSERT / UPDATE | CHECK 違反 |
| 2 | M1: 閲覧者で `save_daily_report` / `approve_overtime` / `delete_worker_project_day` | `42501` |
| 3 | M1: 担当者で他人の名前・ID を申告して保存 | 保存できる（代理入力） |
| 4 | DB-4: 別の日の `record_id` を `updates` に入れて送る | `22023`、何も変わらない |
| 5 | DB-4: 別の現場の `record_id` を `delete_ids` に入れて送る | その行は消えない |
| 6 | DB-4: 同じ日の他の現場の行を `hours` / `overtime_hours` だけで更新 | 更新される（休憩の再計算） |
| 7 | DB-4: 同じ日の他の現場の行を `note` 付きで更新 | `22023` |
| 8 | DB-5: 管理者が行を UPDATE した後、古い `expected_versions` で送る | `PT409`、何も変わらない（休憩設定も） |
| 9 | DB-5: 管理者が行を DELETE した後、古い `expected_versions` と `fallback_insert` で送る | `PT409`（Q1）。行は追加し直されない |
| 10 | DB-5: `expected_versions` 無しで送る（旧画面） | 今までどおり保存される |
| 11 | DB-5: 管理者が進捗を変えた後、古い `expected_progress` で送る | `PT409` |
| 12 | DB-5: 戻り値の `versions` がその日の全行の `updated_at` と一致 | 一致 |
| 13 | DB-6: 作業員が時間を直した後、職長が古い `p_expected_hours` で承認 | `PT409`、承認待ちのまま |
| 14 | DB-6: 3 引数で呼ぶ（旧画面） | 承認できる（M4 の後は作業員だと止まる） |
| 15 | DB-7: `break_durations` 付きで送る | 休憩設定が保存され、`updated_at` が日報の行と同じ |
| 16 | DB-7: 日報の保存が途中で失敗（存在しない工種） | 休憩設定も変わらない |
| 17 | DB-7: 不正な `break_durations`（文字列・4 つ・負の値） | `22023` |
| 18 | DB-1: 作業員で `TaskRecords` を INSERT / UPDATE / DELETE | 0 行または RLS 違反 |
| 19 | DB-1: 作業員で他人の休憩設定を upsert（M3 の仮ポリシー） | RLS 違反。本人の行は通る |
| 20 | DB-2: 職長でない作業員で `TaskRecords` / 承認 2 表を SELECT | 本人の行だけ |
| 21 | DB-2: 職長で SELECT | 本人の行 + 職長の現場の行 |
| 22 | DB-2: `get_task_record_presence` | 全員分の（現場・名前・日付）。時間の列は無い。63 日以上は `22023` |
| 23 | DB-9: 作業員・閲覧者で `Projects` / `projects_directory` | 基表 0 件、ビューは全現場（金額の列なし） |
| 24 | DB-9: 退職者・紐付けの無いログインで `projects_directory` | 0 件 |
| 25 | 担当者で全部 | 今までどおり読み書きできる |

### 8.2 画面

- Vitest（`environment: 'node'`）: payload を組み立てる純粋関数（`expected_versions`・変えた工種だけの進捗・`break_durations`）。
  `worker-daily-report-refactor.md` のフェーズ 1 で `handleSubmit` の組み立てを純粋関数に出すので、それに合わせてテストを書く。
- 手動確認: `worker-daily-report-refactor.md` §7 の手順に、「管理者が時間を直した後に作業員が送る → 競合の表示」「職長が一覧を開いたまま作業員が時間を直す → 承認で競合の表示」「作業員画面の配置表に実績が出る」「作業員画面と工程表に現場が出る（金額の列が届いていない）」を足す。

---

## 9. 影響範囲（ファイル）

| ファイル | 変更 | 段階 |
|---|---|---|
| `supabase/migrations/`（新規 4 本） | §6 の M1〜M4 | M1〜M4 |
| `src/hooks/useDailyReport.js` | `fetchProjectsResult` をビューに、`saveDailyReport` の戻り値（`breakSaved` / `versions`）、`deleteProjectDayRecords` の予備の削除、presence RPC の関数 | F1・F2 |
| `src/WorkerApp.jsx` | `handleSubmit` の payload（`expected_versions` / `break_durations` / 変えた工種だけの進捗）、`PT409` / `22023` の扱い、休憩設定の別リクエストを予備に、`projects` キャッシュのキーと古いキャッシュの削除、承認の呼び出しに見た値を渡す | F1・F2 |
| `src/hooks/useWorkerAssignments.js` | `TaskRecords` の直接読みを `get_task_record_presence` に | F1 |
| `src/hooks/useScheduleViewData.js` | `Projects` を `projects_directory` に | F1 |
| `src/lib/overtimeApprovals.js` / `src/lib/workAllowanceApprovals.js` | 承認に見た値を渡す、`PGRST202` で呼び直す | F1・F2 |
| `src/utils/draftQueueUtils.ts` | 下書きの slot に `updated_at` を持たせる（キーを足すだけ） | F1 |
| `src/components/tabs/settings/StaffLoginDialog.jsx` / `StaffSettings.jsx` | `STAFF_ROLE.WORKER` の扱い（§4.1） | F1 |
| `src/types/supabase.ts` | 型を作り直す（`TaskRecords.updated_at`、`projects_directory`、新しい RPC） | F1 |
| `scripts/test-daily-report-hardening-db.py` / `tests/db/daily-report-hardening-fixture.sql`（新規） | §8.1 | M1〜M4 |
| `docs/specs/database.md` | `TaskRecords` の `updated_at`・`early_overtime_hours`、`projects_directory` | M2 |
| `docs/specs/security-permissions.md` | 権限の表（`Projects` の worker / viewer、日報の本人性） | M3 |
| `docs/specs/worker-login.md` | §3.4・§6 フェーズB の 3・§8 を「済み」に | M1・M3 |
| `docs/specs/worker-daily-report-refactor.md` | §9 の DB-1〜7・9 にこの設計書へのリンク | — |

`WorkerApp.jsx` の `handleSubmit` は、`worker-daily-report-refactor.md` のフェーズ 0.5〜1 でも触る。
F1 はフェーズ 0.5（F0-1〜F0-9）を入れた後、フェーズ 1 で payload の組み立てを純粋関数に出すのと同時か、その後に入れると衝突が少ない。

---

## 10. 今回やらないこと

| ID | 内容 | 理由 |
|---|---|---|
| DB-8 | 振替元の日報を消しても振休が残る | 権限の穴ではない。`worker-daily-report-refactor.md` §9 のまま |
| DB-10 | 時間枠ごとの UUID で再送の二重を防ぐ | 一意索引の作り直しが要る。§4.5 の「残る制約」もこれで直す |
| DB-11 | 承認の差し戻し・取り消し | 機能の追加 |
| — | 協力業者（`SubcontractorRecords`）の楽観ロック | 今回は日報と進捗だけ。同じ作りで足せる |
| — | `is_declared_worker` / `is_declared_foreman` を authenticated が直接呼べる（作業員の名前と ID の組・職長かを確かめられる） | 漏れる情報は名簿と配置表で見えるものと同じ。直すなら内部関数にして RPC からだけ呼ぶ |
| — | `TaskRecords` を `worker_name` ではなく `worker_id` で持つ | `worker-login.md` §8 の宿題のまま |
| — | 在庫（`InventoryItems`）の記録者を DB で決める | `worker-login.md` §8 の宿題のまま |
