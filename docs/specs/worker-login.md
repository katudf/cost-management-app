# 作業員の個人ログイン（共有アカウント＋名前選択の廃止） 設計書

- 作成日: 2026-11-07（同日、レビュー指摘を反映して改訂）
- 状態: フェーズAを実装済み（2026-11-07、ブランチ `feat/worker-login`。2026-11-09 本番反映済み）。
  2026-11-10 に「担当者のIDに統合」（§5.2）を追加（ブランチ `feat/merge-worker-login-into-staff`・本番未反映。
  反映はマイグレーション `20261110000000` → Edge Function `manage-staff-login` → 画面の順）。
  本番への反映はマイグレーション `20261107020000` → Edge Function `manage-staff-login` / `invite-staff` → 画面の順（画面を先に出すと
  作業員アカウントの判定ができない。担当者の画面は `get_my_worker` が無くても動くようにしてある）。
  2026-11-09 に本番反映済み。同日、フェーズBの 1・2 を実施（共通IDはユーザーが削除済み。作業員アプリ・在庫アプリの名前選択と
  `shared_worker` の区分を削除し、担当者は入力画面の帯で作業員を切り替える。§4.2）。フェーズBの 3・4 は未着手。
  2026-11-07 にユーザー確認済み: §3.4 の残るリスクは共有アカウント廃止まで先送り／§5 `link_staff_account` の紐付け対象の限定／
  決定 #8 の「退職日を入れた時点で（未来日でも）BAN」は、いずれも現設計のまま
- 実装: `supabase/migrations/20261107020000_worker_personal_login.sql`、`supabase/functions/manage-staff-login/handler.ts`、
  `src/hooks/useAuth.jsx` / `useWorkerLogins.js`、`src/components/tabs/settings/WorkerLoginDialogs.jsx`、`src/WorkerApp.jsx` / `InventoryApp.jsx`。
  テストは `scripts/test-worker-login-db.py`（`tests/db/worker-login-fixture.sql`）、`handler.test.ts`、
  `src/utils/kanaToRomaji.test.js` / `resignation.test.js` / `draftQueueUtils.test.ts`
- 実装で設計から変えた点:
  - **`is_office_or_admin()` を NULL を返さないように直した**。ロールの無いログイン（退職した作業員など）で
    `IF NOT (is_office_or_admin() OR current_staff_role() = 'worker')` が NULL になり、権限エラーを素通りして
    日報を保存できた（DB テストで発見。見積 RPC で `20260910054306` が塞いだのと同じ問題）。§3.2 の RPC の作業員判定も
    `COALESCE(... , false)` にした。さらに `current_staff_role()` 自体も、ロールが無いときは NULL ではなく `'none'` を返す
    （使っている側はすべて `=` / `IN` の比較なので、どのロールにも一致せず「権限なし」になる）。作業員の判定は
    `current_worker_id()` を重ねずに 1 つの問い合わせで引く
  - 下書きの「同一性キー」（`draftKey`）は `workerId` があれば ID で作る（同姓同名・改名で別人の下書きと混ざらないように）。
    以前の名前だけの下書きは、同じ現場・日付・本人なら同じものとして上書き・削除する（`isSameDraftTarget`。§4.2）
  - 作業員の削除（ログインごと）は管理者だけでなく**事務以上**に許可する（ログインの無い作業員はもともと事務が削除できるため）。
    ただし管理者と共有のIDを持つ作業員は、システム管理者だけが削除できる（`assert_can_delete_worker`）
  - 担当者兼作業員が承認したときの承認者名は、作業員としての名前にする（自分の申請を承認したら確認済みにできるように）
  - 担当者か作業員かを取得できず端末の記録も無いとき（通信不可の初回など）は、セッション種別を `UNKNOWN` とし、
    共有アカウントと同じく作業員を選べる画面にする（オンラインに戻ったら取り直す）
  - 作業日報・在庫アプリの「選んだ作業員・現場」の保存キーはログインしている人ごと（`cost-app-worker:<uid>` など）。
    以前のキーの値はログイン時に移して消す
  - 作業日報アプリの「工程表」リンク（決定 #11）は追加していない。作業日報アプリに既に「配置表」ボタン（同じ配置予定表の閲覧）があるため
  - 承認者名・本人の決め方は RPC ごとに書かず、内部関数 `_effective_worker()` / `_approver_name()` にまとめた
  - 作業員マスタの退職日の保存時は、ログインのある作業員で退職日が変わったときだけ `sync_ban` を呼ぶ
  - 担当者の `create`（同じ人が作業員IDを持っている場合）は変えていない（§5.1 のとおり当面は運用で `link_staff_account`）
- 前提: [`login-id.md`](login-id.md)（独自ログインID。フェーズ1公開済み）
- 関連: [`security-permissions.md`](security-permissions.md)（§3.3 作業員認証の選択肢・§5 日報の本人性）

## 1. 目的と背景

作業日報（`WorkerApp.jsx`）と在庫管理（`InventoryApp.jsx`）は、作業員の共有アカウント
（`office_staff.id=18`「現場作業員（共通）」、role=`worker`）でログインしたあと、
「名前を選んでください」の一覧から作業員を選ぶ方式になっている（`security-permissions.md` §3.3 の案C）。
選んだ作業員は `localStorage` の `cost-app-worker` に保存され、2つのアプリで共用している。

この方式では誰でも他人の名前を選んで日報を入力・承認できる。案Cを選んだ理由は「作業員に会社メールが無い」ことだったが、
独自ログインID（`login-id.md`）でメールアドレスが不要になったので、**案A（作業員ごとの個人アカウント）に切り替える**。

今回（フェーズA）で防げるのは「画面とRPCでのなりすまし」まで。`TaskRecords` などへの REST での直接書き込みは
RLS の本人限定（§8）まで残る（§3.4）。

## 2. 決定事項

| # | 論点 | 決定 |
|---|------|------|
| 1 | 個別ログインの方式 | 作業員ごとに Auth アカウント（独自ID＋パスワード）を発行し、`Workers.auth_user_id` で紐付ける。作業員アカウントでは名前選択を出さない |
| 2 | 担当者のセッションで作業員アプリを開いたとき | **代理モード**として残す。日報は `?workerId=` で対象を決め、在庫は担当者名で記録（`worker_id` は NULL）。名前選択は担当者にだけ出す |
| 3 | 共有アカウント（id=18） | 移行期間だけ残す（共有アカウントのときだけ名前選択を出す）。全作業員にIDを配り終えたら BAN → 削除し、名前選択のコードも消す |
| 4 | ID を管理する人と画面 | admin / system_admin だけ。作業員マスタ（`WorkersTab.jsx`）の行から操作する。サーバーは `manage-staff-login` を作業員にも広げる |
| 5 | DB での本人限定 | 日報 RLS の本人限定は次の段階（共有アカウント廃止後）。ただし `current_worker_id()` は今回作り、作業員IDや名前を引数で受け取るRPCはすべて、作業員アカウントではそれを使う（§3.2） |
| 6 | 端末と下書き | 原則1人1台。ログインは保持する。下書きは作業員ごとに分け、鍵を名前から `worker_id` に変える |
| 7 | 担当者と作業員の両方にいる人 | 1人1ID。担当者（office / admin / system_admin）のアカウントに `Workers.auth_user_id` も紐付けられる。ロールは `office_staff` を優先 |
| 8 | 退職・削除 | 退職日を入れた時点で（未来の日付でも）BAN。退職日を消したら解除。DB 側でも退職済みの作業員には権限を返さない。削除は「BAN → 行の削除 → Auth の削除」 |
| 9 | 本人によるパスワード変更 | 作業員アプリのメニューに出す（`OwnPasswordChange.jsx` を使い回す） |
| 10 | ID の付け方 | 管理者が自由に決める（形式は `login-id.md` と同じ）。発行ダイアログで `Workers.kana` からローマ字の候補（例: `sato_k`）を入れる |
| 11 | 作業員アカウントでの工程表 | 見られる（RLS は元から許可）。作業日報アプリのメニューに工程表へのリンクを置く。viewer 共有アカウントは作業員以外向けに残す |

## 3. 方式

### 3.1 紐付けとロール判定

- `Workers` に `auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL` を追加する。
- **保護トリガー**（`office_staff` の `protect_office_staff_privileged_columns` と同じ方式。bypass フラグは service_role 専用 RPC だけが立てる）:
  - `auth_user_id` の INSERT 時の指定・UPDATE は、admin を含めて bypass なしでは拒否する
  - `auth_user_id IS NOT NULL` の行の DELETE は bypass なしでは拒否する（§5 の `delete` を経由させる。今は `useWorkers.js` から直接 DELETE しており、office も `workers_office_all` で消せる）
- **`current_staff_role()` を広げる**（ポリシー100か所以上はそのまま）:
  1. `office_staff.auth_user_id = auth.uid()` の行があればその role（従来どおり。決定 #7 で担当者を優先）
  2. なければ `current_worker_id()` が NULL でなければ `'worker'`
  3. どちらもなければ NULL
- `current_worker_id()` を新設する（`security-permissions.md` §3.2 で予定していたもの）:
  `Workers.auth_user_id = auth.uid()` かつ退職していない行の id。担当者兼作業員でも返す。
  - 退職の判定は `resignation_date IS NULL OR resignation_date > (now() AT TIME ZONE 'Asia/Tokyo')::date`（DB の `current_date` は UTC のため）
- `is_personal_worker()` を新設する: `office_staff` に行が無く、`current_worker_id()` が NULL でない。
  **「作業員アカウント」の判定はすべてこれで行う**（`current_staff_role() = 'worker'` は共有アカウントでも真、
  `current_worker_id()` は担当者兼作業員でも真になるため）。
- **`is_staff()` は変えない**。使っているのは `workers_directory` ビューと `stamps_select_staff`（印影バケット）の2か所だけで、
  印影は作業員アプリで使わないため、作業員アカウントには開かない。ビューの条件だけを `is_staff() OR is_personal_worker()` にする
  （今のままでは作業員アカウントに名簿が空で返る）。
- 退職日は DB 側の判定が正で、BAN（§5）は補助。BAN が失敗・遅延しても権限は残らない。
- 性能: ヘルパーは SECURITY DEFINER・STABLE。`Workers.auth_user_id` は UNIQUE 制約で索引が付く。新しく書くポリシーでは `(SELECT current_staff_role())` の形で1回評価にする。

### 3.2 作業員IDや名前を引数で受け取るRPC（なりすまし対策）

次のRPCは、クライアントが送った作業員ID・名前（`is_declared_worker` / `is_declared_foreman` は「IDと名前の組」しか見ない）で本人・職長を判定している。

| RPC | 引数 | 定義 |
|-----|------|------|
| `save_daily_report` | payload の `worker_id` / `worker_name` | `20261105040000` |
| `add_project_task` | `p_worker_id` / `p_worker_name` | `20261105020000` |
| `delete_worker_project_day` | `p_worker_name` | `20261105020000` |
| `approve_overtime` / `approve_work_allowance` | `p_approver_worker_id` / `p_approver_name` | `20261105030000` |
| `acknowledge_approvals` | `p_worker_id` / `p_worker_name` | `20261105030000` |

- **`is_personal_worker()` のとき**: 作業員IDは `current_worker_id()`、名前はその `Workers.name` を使い、引数は無視する
  （名前だけでなくIDでも一致させる。同じ名前の別人がいても通らない）。
- **担当者（`is_office_or_admin()`）のとき**: 代理モードなので、対象の作業員は引数のまま使う。
  ただし承認の `approved_by` は引数の名前ではなく、**呼び出した担当者の `office_staff.name`** をサーバーで入れる（代理で承認したのに作業員本人の名前で残るのを防ぐ）。
- **共有アカウント（移行期間）のとき**: 本人を特定できないので、従来どおり引数を使う。
- 共有アカウントの廃止後も引数は消さず、`DEFAULT NULL` にして無視する（古い PWA のキャッシュが壊れないように）。

### 3.3 日報の書き込み

`TaskRecords` は `worker_name` で作業員を持っている（一意索引も `worker_name`）。今回は列の構成を変えない。
作業員アカウントでは §3.2 のとおり RPC がサーバー側で名前を決める。

### 3.4 フェーズAで残るリスク

- `TaskRecords`・`WorkerDailyBreakSettings` は worker ロールに FOR ALL を許しており、画面も一部を直接書いている
  （`useDailyReport.js` の休憩設定の upsert、日報削除のフォールバック）。REST を直接叩けば、作業員アカウントでも他人の行を書ける。§8 で塞ぐ。
- 在庫（`InventoryItems`）の `worker_id` / `recorded_by` はクライアントが送る値のまま。作業員アカウントでは画面が本人の値を入れるが、DB では守られない。§8 で検討する。

## 4. 画面

### 4.1 `useAuth.jsx`

- `currentWorker` を追加する。`office_staff` と同じタイミングで、RPC `get_my_worker()` で取る（`Workers` 基表の worker 向け SELECT は削除済みのため、直接 `from('Workers')` はしない）。
- **オフライン対策**: 取れた `currentWorker` を `localStorage` に `auth.uid()` を鍵にして保存する。取得に失敗したとき（通信エラー）はそれを使う。
  今は `cost-app-worker` から復元してオフラインでも起動できており、これを失わないようにする。
- 画面で扱う区分（`sessionKind`）:
  - `staff`: `currentStaff` があり role が office / admin / system_admin
  - ~~`shared_worker`: `currentStaff?.role === 'worker'`（共有アカウント）~~ フェーズBで削除。role が worker の担当者行が残っていても `other`
  - `unknown`: 初めてのオフライン起動で、まだ誰か分からない。使えない旨と「再読み込み」を出し、通信が戻ったら判定し直す
  - `personal_worker`: `currentStaff` が無く `currentWorker` がある
  - `other`: それ以外（viewer 共有アカウント、退職者、どこにも紐付かない Auth ユーザー）
- AdminApp は今の `canUseAdminApp(currentStaff?.role)` のままでよい。`NoPermissionScreen.jsx` は `currentStaff` で案内文を出しているので、
  `personal_worker` のときは「作業日報はこちら」のリンクを出すように直す。

### 4.2 作業日報（`WorkerApp.jsx`）

ログイン後の分岐:

| sessionKind | 作業員の決め方 | 名前選択 |
|-------------|---------------|---------|
| `personal_worker` | `currentWorker` に固定。`?workerId=` は無視 | 出さない |
| `staff` | `?workerId=` → この端末で前回選んだ作業員 → 担当者兼作業員なら本人 → 名簿の先頭、の順で決める。入力画面の上の帯のプルダウンで切り替える（本人以外なら「代理入力中」の帯） | 出さない（フェーズBで削除） |
| `unknown` | 使えない旨と「再読み込み」 | ― |
| `other` | 権限なし画面（ログアウトボタンつき） | ― |

- `personal_worker` では `localStorage` の `cost-app-worker` を読まない・書かない。
  `staff` / `shared_worker` で使う場合も、キーを `cost-app-worker:<auth.uid()>` にして、別の人のログインに持ち越さない。
- 代理モードでは、画面の上に「代理入力中：○○さん」の帯を出す。承認のお知らせの「確認した」は出さない（本人が見ていないため）。
- ヘッダーの「作業員を切り替える」操作は `personal_worker` では出さず、ログアウトだけにする。
- メニューに「パスワード変更」（`personal_worker` のみ）と「工程表」へのリンク（`?mode=schedule`）を追加する。
- 名簿の退職者の除外（今は `!w.resignation_date` で一律）を、DB と同じく「退職日が今日以前」に揃える。
- **下書き**（`offlineCache.js` / `draftQueueUtils.ts`）:
  - 作業員を分ける鍵を名前から `worker_id` に変える（名前の変更で自分の下書きが見えなくなる・同名の別人と混ざるのを防ぐ）
  - 既存の下書きは、読み込み時に名簿の名前から `worker_id` を補う。**同じ名前が2人以上いる・名前が見つからないときは補わず**、名前の一致で今までどおり扱う
  - ログアウト時の確認と削除は、自分の分だけを対象にする
- 名前を鍵にしたキャッシュ（`worker-daily-records-<名前>` など）も `worker_id` を鍵にする。`cost-app-worker-project` は `auth.uid()` ごとに分ける。

### 4.3 在庫管理（`InventoryApp.jsx`）

| sessionKind | 記録者（`recorded_by` / `worker_id`） | 名前選択 |
|-------------|--------------------------------------|---------|
| `personal_worker` | 本人の名前 / 本人の id | 出さない |
| `staff` | 担当者の名前 / NULL | 出さない |
| `unknown` | 使えない旨と「再読み込み」 | ― |
| `other` | 権限なし画面 | ― |

- `cost-app-worker` を日報アプリと共用するのをやめる。

### 4.4 作業員マスタ（`WorkersTab.jsx`）

- admin / system_admin のときだけ、各行にログインの状態とボタンを出す。

| 行の状態 | ボタン |
|----------|--------|
| 未発行 | 「ID発行」（ログインID・パスワード×2）／「担当者のIDを紐付ける」（決定 #7） |
| 発行済み | 「パスワードリセット」「ID変更」「担当者のIDに統合」（担当者と共有していないときだけ。§5.2）「ログイン解除」 |
| 退職済み | ログインIDと「停止中」の表示だけ |

- ダイアログは `StaffLoginDialog.jsx` を、対象が担当者か作業員かを受け取れるように広げて使い回す。
- 「担当者のIDを紐付ける」で選べるのは、ログインIDのある office / admin / system_admin の担当者だけ（共有アカウント・viewer は出さない。サーバーでも拒否する §5）。
- ID の候補: `Workers.kana` をヘボン式ローマ字にし、「姓_名の頭文字」（例: サトウ カツヨシ → `sato_k`）。
  使われていれば `sato_k2` のように番号を付ける。kana が空なら候補なし。
- 一覧のログインIDは RPC `get_worker_login_ids()`（admin のみ全行）で取る。`Workers` に ID の写しは持たない（`login-id.md` §3.2 と同じ考え）。
- 退職日を保存したら（office が保存した場合も）、Edge Function の `sync_ban` を呼ぶ（§5）。失敗したらトーストで知らせる（DB 側の判定で権限はすでに無いことも添える）。
- 作業員の削除は、`auth_user_id` がある行は Edge Function の `delete` を経由する（`useWorkers.js` の直接 DELETE は紐付きの無い行だけ）。

### 4.5 ログイン画面

`LoginScreen` は変えない（`autoCapitalize="none"`、小文字への正規化は実装済み）。

## 5. サーバー側（`manage-staff-login`）

リクエストに `target: 'staff' | 'worker'`（省略時 `'staff'`）を加える。`target: 'worker'` では `staffId` の代わりに `workerId` を受け取る
（今は冒頭で `staffId` を必須にしているので、そこから作り替える）。

| action | worker での処理 | 呼べる人 |
|--------|----------------|---------|
| `create` | `createUser({ email, password, email_confirm: true, app_metadata: { worker_id } })` → 紐付け RPC（指紋の同期を含む） | admin |
| `merge_into_staff`（2026-11-10 追加） | 作業員の自分のログインを、同じ人の担当者のログインに統合する（§5.2） | `link_staff_account` と同じ |
| `link_staff_account`（新規） | 担当者の `auth_user_id` をその作業員にも紐付ける。**担当者の role が office / admin / system_admin でログインIDがあるときだけ**（共有アカウント・viewer を紐付けると、その全利用者がその作業員になれてしまうため） | admin。admin / system_admin の担当者は system_admin のみ |
| `reset_password` | `login-id.md` §5 と同じ | admin（担当者と共有のアカウントは担当者の権限ルールに従う） |
| `change_login_id` | 同上 | 同上 |
| `unlink`（新規） | 紐付けを外す。担当者と共有でなければ Auth ユーザーを BAN → 削除 | admin |
| `delete` | BAN → `Workers` の行の削除 → Auth の削除（担当者と共有なら Auth は消さず紐付けだけ外れる） | admin |
| `sync_ban`（新規） | **クライアントから BAN するかを受け取らず**、サーバーが `Workers.resignation_date` を読んで BAN 状態を揃える。担当者と共有のアカウントは BAN しない（担当者としては使い続けるため。作業員としての権限は DB 側の判定で無くなる） | office 以上（退職日は office も保存できるため） |

- 権限確認・紐付け・管理者リセットの記録は、担当者用（`assert_can_manage_staff_login` / `link_staff_login` / `log_admin_password_reset`）と同じ形の作業員版 RPC を作る（service_role 専用）。
  ID 発行・リセットのときは `password_change_log_state` の指紋も同期する（しないと、発行直後に本人が `log_password_change('self')` で偽の「本人変更」を記録できる）。
- `log_password_change`（本人変更の記録）を作業員アカウントにも対応させる。
- `password_change_logs` に `worker_id` 列を追加する。画面（`PasswordChangeLogs.jsx`）は担当者名か作業員名を表示する。
- `email_exists` は 409 にし、既存ユーザーに紐付けない（`login-id.md` §5 と同じ）。

### 5.1 担当者側の操作への波及

- 担当者の `delete`: その Auth ユーザーが作業員にも紐付いていれば、Auth ユーザーを消さずに担当者の行だけ消す
  （今の処理では `ON DELETE SET NULL` で作業員側のログインが黙って外れる）。
- 担当者の `create`: 同じ人が作業員IDを持っていれば2つ目のIDになる。担当者設定に「作業員のIDを紐付ける」を足すかは実装時に決める（当面は運用で、作業員マスタ側から `link_staff_account` する）。
- 旧 `invite-staff`（`login-id.md` でフェーズ2に削除予定）は、既存の Auth ユーザーをメールで探して担当者に紐付ける処理が残っている。
  `@login.invalid` のメールを拒否するようにする。

### 5.2 担当者のIDへの統合（`merge_into_staff`。2026-11-10 追加）

作業員のIDを発行したあとで、同じ人に担当者のIDもある（または作った）とき、1人1ID（決定 #7）に寄せるための操作。
これまでは「ログイン解除 → 担当者のIDを紐付ける」の2段階で、2段目が失敗するとログインの無い人が出た。2026-11-10 にユーザーと決めた内容:

| 論点 | 決定 |
|------|------|
| まとめる範囲 | ログインだけ。`Workers` と `office_staff` の行は別々のまま（名簿の統合はしない） |
| 残すID | 担当者のID。`office_staff` は変えず、`Workers.auth_user_id` を担当者のものに付け替え、作業員の古い Auth ユーザーは BAN → 削除 |
| 入口 | 作業員マスタのログイン操作で、自分のIDがある（担当者と共有していない・退職日の無い）作業員にだけ「担当者のIDに統合」を出す。担当者の選び方は「担当者のIDを紐付ける」と同じダイアログ |
| 権限・統合先の条件 | `link_staff_account` と同じ（admin 以上。統合先は office 以上・ログインIDあり・まだ作業員に紐付いていない。admin / system_admin のIDはシステム管理者だけ） |
| 端末 | 特別な処理はしない。作業員のIDの端末は次のセッション確認でログアウトされ、未送信の下書き（`workerId` が鍵）は担当者のIDで入り直せばそのまま送れる |

サーバーの順序（`handler.ts`）:

1. `assert_can_merge_worker_into_staff`（作業員・担当者の条件をすべて確かめる。ここで断られたら何も変えない）
2. 作業員の古い Auth ユーザーを BAN
3. `merge_worker_login_into_staff`（行ロックで確かめ直し、BAN したユーザーが今も紐付いていることを確かめて付け替える。失敗したら BAN を解く）
4. 古い Auth ユーザーを削除（失敗したら「統合済み・停止済み。Supabase の管理画面で削除を」と 500 で知らせる。画面は一覧を取り直す）

- 担当者側の条件は `_assert_staff_linkable` に切り出し、`link_worker_to_staff_login` もそれを使うように作り直した（動きは同じ）。
- 古い Auth ユーザーのパスワード変更の記録（`password_change_logs`）は `worker_id` 付きで残るので、作業員名で表示され続ける。

## 6. 移行手順

### フェーズA: 併用

1. マイグレーション（§7）を適用する
2. Edge Function と作業員マスタのボタン、作業員アプリ・在庫アプリの分岐を公開する。共有アカウントは今までどおり使える
3. admin が作業員ごとに ID を発行し、本人に紙・口頭で伝える。本人のスマホで1回ログインするところまで確認する
4. 管理画面で、在籍中の作業員のうち ID 未発行の人を数えられるようにしておく（作業員マスタの絞り込み）

### フェーズB: 共有アカウント廃止

在籍中の作業員全員に ID が発行されたら、**廃止日を決めて作業員に告知し、その日に止める**。
（ログインを保持するため、共有アカウントの端末はリフレッシュトークンで使い続けており、`last_sign_in_at` では使われているかどうか分からない。
参考として `auth.sessions` の更新日時を見る。）

1. 共有アカウント（`office_staff.id=18`）を BAN → 削除する（2026-11-09 ユーザーが削除済み）
2. 作業員アプリ・在庫アプリから、`shared_worker` 向けの名前選択と `cost-app-worker` の処理を削除する（2026-11-09 実施。担当者が日報アプリで選んだ作業員の保存 `cost-app-worker:<uid>` は代理入力用に残す）
3. §3.2 のRPCで、共有アカウント向けの分岐を消す（引数は `DEFAULT NULL` で残して無視）
4. `security-permissions.md` の作業員認証を案Aに更新し、パスワードが平文で載っている記述があれば削除する

## 7. 影響範囲

| ファイル | 変更内容 |
|----------|----------|
| `supabase/migrations/`（新規） | `Workers.auth_user_id`・保護トリガー、`current_worker_id()` / `is_personal_worker()`、`current_staff_role()` の拡張、`workers_directory` の条件、`get_my_worker()` / `get_worker_login_ids()`、作業員版の権限確認・紐付け・リセット記録 RPC（service_role 専用）、`log_password_change` の作業員対応、`password_change_logs.worker_id`、§3.2 の6つのRPC |
| `supabase/functions/manage-staff-login/`（`handler.ts` / `handler.test.ts`） | `target: 'worker'`、`link_staff_account` / `unlink` / `sync_ban`、担当者 `delete` の兼任対応 |
| `supabase/functions/invite-staff/` | `@login.invalid` の拒否 |
| `src/hooks/useAuth.jsx` | `currentWorker`（オフライン用の保存つき）、`sessionKind` |
| `src/WorkerApp.jsx` | ログイン後の分岐、代理モードの帯、メニュー（パスワード変更・工程表）、名簿の退職判定、名前を鍵にしたキャッシュ |
| `src/InventoryApp.jsx` | 記録者の決め方、名前選択の条件 |
| `src/utils/offlineCache.js` / `src/utils/draftQueueUtils.ts` | 下書きの鍵を `worker_id` に |
| `src/hooks/useDailyReport.js` | §3.2 の RPC 呼び出し（作業員アカウントでは作業員ID・名前を送らなくてよい） |
| `src/lib/overtimeApprovals.js` / `workAllowanceApprovals.js` / `approvalNotices.js` | 同上 |
| `src/components/tabs/WorkersTab.jsx`・`src/hooks/useWorkers.js` | ログイン状態の表示・ボタン、退職日保存時の `sync_ban`、紐付き行の削除を Edge Function 経由に |
| `src/components/tabs/settings/StaffLoginDialog.jsx` | 作業員も扱えるように |
| `src/components/tabs/StaffSettings.jsx`・`src/hooks/useStaffSettingsData.js` | 削除時の兼任の案内 |
| `src/components/auth/NoPermissionScreen.jsx` | 作業員アカウントへの案内 |
| `src/components/tabs/settings/PasswordChangeLogs.jsx`・`src/hooks/usePasswordChangeLogs.js` | 作業員名の表示 |
| `src/utils/kanaToRomaji.js`（新規） | ID の候補作り |
| `src/types/supabase.ts` | 再生成 |
| `tests/db/`・`scripts/test-*-db.py` | §9 の DB テスト |
| `docs/design.md`・`docs/specs/security-permissions.md`・`docs/manuals/`（worker / admin） | ログイン方法・ID発行の手順 |

## 8. 次の段階（今回の対象外）

- 日報（`TaskRecords`）・`WorkerDailyBreakSettings` の RLS を「本人＋担当工事の職長＋office 以上」に絞る（`security-permissions.md` §5 の「日報の本人性」）。
  あわせて画面の直接書き込みを RPC に寄せる
- 在庫の記録者（`worker_id` / `recorded_by`）を DB 側で決める
- `TaskRecords` を `worker_name` ではなく `worker_id` で持つかの検討

## 9. テスト

- DB（`tests/db` の流儀）:
  - 作業員アカウントの `current_staff_role()` が `'worker'`、退職日が今日（日本時間）以前なら NULL
  - 担当者兼作業員は担当者の role が返り、`current_worker_id()` も返る。`is_personal_worker()` は偽
  - 作業員アカウントが `workers_directory` を読め、`stamps` バケットは読めない
  - admin・office・作業員本人が `Workers.auth_user_id` を変えられず、紐付き行を直接 DELETE できない
  - 作業員アカウントが §3.2 の各RPCに他人の作業員ID・名前を送っても、自分として扱われる（職長でなければ職長操作は拒否、他人の日報は消せない）
  - 退職した作業員アカウントは日報保存・承認を拒否される
  - 担当者が代理で承認すると `approved_by` は担当者名になる
  - 共有アカウント・担当者での §3.2 のRPCは従来どおり通る
  - 共有アカウント・viewer の担当者は作業員に紐付けられない
  - 担当者のIDへの統合（§5.2）: 自分のIDが無い・担当者と共有済み・退職日ありの作業員、共有アカウント・メールのままの担当者・
    別の作業員に紐付いた担当者は断る。確認後に紐付けが変わっていたら断る。統合後は担当者の role のまま `current_worker_id()` が返り、
    古いIDはロールなし
  - 作業員のID発行直後に `log_password_change('self')` を呼んでも記録されない
- Vitest:
  - kana → ローマ字の候補（長音・拗音・促音、重複時の番号）
  - 下書きの鍵の移行（同名・名前なしのときは補わない）
  - `handler.test.ts`: `target: 'worker'` の各 action、`sync_ban` の兼任スキップ、担当者 `delete` の兼任対応、
    `merge_into_staff` の順序（確認 → BAN → 付け替え → 削除）と失敗時の戻し
- E2E: 作業員IDでログイン→名前選択が出ない／担当者で `?workerId=` → 代理モードの帯／共有アカウントでは名前選択が出る／viewer で作業員アプリ → 権限なし画面
