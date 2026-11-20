# 作業員日報画面 リファクタリング設計書

- 作成日: 2026-11-20
- 対象: 作業員画面（`src/WorkerApp.jsx` 全体と、そこから使う hooks / utils / `components/worker/*`）
- 根拠: 6 体のエージェントによる現状コードのレビュー（分割設計・不具合・計算・規約・データと権限・現場利用者）。指摘のうち重要なものはコードで裏付けを取った
- 行番号は 2026-11-20 時点（コミット `f789415`）のもの

---

## 1. 目的と決定事項

`WorkerApp.jsx` は 2412 行あり、`useState` が 39 個、`useEffect` が 13 個ある。日報の入力・送信のほか、下書きとオフライン、前日コピー、並び替え、職長の承認、お知らせ、PDF 出力、ログアウトまでを 1 つのコンポーネントで持っている。これを関心ごとに分けて、テストできる形にする。あわせて、現場で使いやすいように画面も直す。

| 項目 | 決定 |
|---|---|
| 範囲 | 作業員側のみ。`WorkerApp.jsx` 全体（承認・お知らせ・PDF・認証まわりを含む）。管理側の `DailyReportTab` / `InputTab` は対象外 |
| 動きの変更 | 分割の途中（フェーズ 1〜3）では動きを変えない。データを壊す不具合はフェーズ 0.5 で先に直す。UI の改善はフェーズ 4 で入れる |
| 安全網 | 純粋関数と reducer は Vitest で現状の動きを固定する。画面は各フェーズの最後に手動確認手順（§7）で確かめる。E2E は後回し |
| 言語 | 純粋関数は `.ts`。フックとコンポーネントは `.js` / `.jsx` |
| 状態管理 | 新しいライブラリは入れない。関心ごとのカスタムフックに分ける。入力フォームだけ `useReducer` にする。Context は必要になってから考える |
| 端末の保存形式 | localStorage のキー名と中身の形は変えない（未送信の下書きを消さないため） |
| DB | テーブル・RPC・RLS は変えない。DB 側の改善案は §9 に記録だけする |

### 前提として分かった制約

- テストは `environment: 'node'` で動いており、jsdom と Testing Library は入っていない（`vitest.config.ts:6`）。ライブラリは足さないので、**フックとコンポーネントの単体テストは書けない**。そのため、ロジックはできるだけ `.ts` の純粋関数と reducer に寄せる。
- `isSyncingQueue`（`WorkerApp.jsx:140`）は宣言されているだけで、どこからも使われていない。下書きの自動再送は無く、オンラインに戻ったときはトーストを出すだけ（235-242）。

---

## 2. 現状の責務マップ

| # | 責務 | 行 | 主な state / ref |
|---|---|---|---|
| R1 | 認証・セッション種別、端末保存のキー | 75-85 | useAuth |
| R2 | 起動時の読み込み（名簿・作業員の決定・現場・時給・下書き）、オンライン監視 | 172-251 | `workers`, `loggedInWorker`, `projects`, `hourlyWage`, `draftQueue`, `isOnline`, `loggedInWorker*Ref` |
| R3 | その日の全現場の実績 | 254-266 | `workerDailyAllRecords` |
| R4 | 休憩設定 | 269-303, 1038-1041, 1139-1151 | `dailyBreakSettings`, `pendingRestoreRef`, `restoreSeqRef` |
| R5 | 旧有給現場の選択を外す | 307-313 | — |
| R6 | 現場の読み込み（作業項目・記録・協力業者・残業申請・職長データ） | 316-446 | `tasks`, `subcontractors`, `overtimeReason`, `dayOvertimeApproval`, `allProjectRecords` ほか |
| R7 | 下請け会社マスタ | 449-457 | `subcontractorDirectory` |
| R8 | 承認のお知らせ | 460-492 | `approvalNotices` |
| R9 | 職長の承認待ち（残業・作業手当） | 495-561 | `pendingApprovals`, `pendingAllowanceApprovals`, `approving*Id` |
| R10 | 作業員の切替・ログアウト | 564-621 | `autosaveEpochRef` |
| R11 | 日報 PDF の出力 | 624-648 | `isExportingPDF` |
| R12 | 作業項目・時間枠の編集 | 651-654, 842-880 | `tasks` |
| R13 | 長押しドラッグでの並び替え | 658-840 | `dragRef`, `reorderTasksRef` |
| R14 | 前日の作業をコピー | 883-960 | — |
| R15 | 協力業者の編集 | 963-969 | — |
| R16 | 作業項目の追加 | 971-1007 | — |
| R17 | 自動保存（1 秒遅延） | 1011-1035 | `autosaveEpochRef` |
| R18 | 時間の計算・重複チェック・下書き通知の絞り込み | 1037-1083 | useMemo |
| R19 | 下書きの復元・破棄 | 1086-1137 | 復元用の ref |
| R20 | 入力済み現場の記録を削除 | 1154-1213 | — |
| R21 | 送信 | 1216-1526 | `isSaving`, `saveMessage` |
| R22-24 | 認証の分岐、描画用の導出値、JSX | 1528-2409 | — |

既存の子コンポーネント `DayLeaveSection`（`useWorkerLeave`）と `WorkerAssignmentView`（`useWorkerAssignments`）は、それぞれ自分の中で完結している。

---

## 3. フェーズ計画

各フェーズは 1 ブランチ・単独でリリースできる大きさにする。

| フェーズ | ブランチ | 内容 | 動きの変更 |
|---|---|---|---|
| 0 | `refactor/worker-p0-safety-net` | 保存形式のテスト、現状の手動確認の記録 | なし |
| **0.5** | `fix/worker-daily-report-integrity` | データを壊す不具合の最小限の修正（§4） | **あり（不具合修正のみ）** |
| 1 | `refactor/worker-p1-pure` | 純粋関数を切り出してテストで固定する（§5.1） | なし |
| 2a | `refactor/worker-p2a-hooks` | 結合の弱いフックを切り出す | なし |
| 2b | `refactor/worker-p2b-form` | reducer と、結合の強いフックを切り出す | なし |
| 3 | `refactor/worker-p3-components` | JSX をコンポーネントに分ける。見た目のクラスは変えない | なし |
| 4 | `feat/worker-ui-*`（候補ごとに分けてよい） | UI の改善（§6）と、残りの不具合の修正 | あり |

### フェーズ 0: 安全網

- `src/utils/offlineCache.test.js` を新しく作る。メモリ上の localStorage と `navigator.onLine` を `globalThis` に差し込み、次を固定する。
  - キー名: `cost-app-draft-queue`、`cost-app-cache-<key>`
  - 下書き 1 件の形: 入力内容に `queueKey` と `timestamp` が付く
  - `fetchWithCache`: 空配列はキャッシュしない、失敗したらキャッシュを返す、キャッシュも無ければ throw する
- 今の形の下書き JSON を 1 件フィクスチャとして置き、復元処理が読めることを確かめる。
- `taskOrderStorageKey` と safeStorage のキー関数のテストを足す。
- §7 の手動確認 A〜P を一通り行い、今の結果を記録して基準にする。
- `WorkerApp.jsx` には手を入れない。

### フェーズ 1〜3 の要点

- フェーズ 1: 関数ごとに「今のロジックを写したテストを書く → `WorkerApp` の該当箇所を関数呼び出しに置き換える」を 1 コミットずつ行う。
- フェーズ 2a: 依存の少ない `useReportPdfExport`、`useOnlineStatus`、`useApprovalNotices`、`useForemanApprovals`、`useSubcontractorDirectory`、`useTaskDragReorder`、`useWorkerDayRecords`、`useWorkerSession` を切り出す。
- フェーズ 2b: reducer、`useRestoreCoordinator`、`useDailyBreakSettings`、`useDailyReportForm`、`useForemanProjectData`、`useDraftQueue` と自動保存、`useDailyReportSubmit`、各種操作、`useUnsavedGuard` を切り出す。§5.4 の結合の順序は変えない。
- フェーズ 3: 外枠の `WorkerApp` と `WorkerReportScreen` に分け、§5.3 の部品に JSX を移す。375px 幅とデスクトップ幅で確かめる。

---

## 4. フェーズ 0.5: 先に直す不具合

分割には数週間かかり、その間もデータが壊れ続けるので、今の `WorkerApp.jsx` に最小限の修正を入れて先にリリースする。DB は変えない方針なので、画面側でできる範囲で直す。根本的な対策は §9 に回す。

| ID | 不具合 | 根拠 | 画面側の修正 |
|---|---|---|---|
| **F0-1** | 端末の古いキャッシュから開いて送ると、消した日報が `fallback_insert` で復活し、二重に計上される | `offlineCache.js:80`（空配列はキャッシュしない）、送信後・削除後にキャッシュを更新していない（1195-1201, 1433-1488）。`WorkerApp.jsx:1303-1308` と RPC（`20261107020000:300-304`） | `offlineCache` にキャッシュを消す関数（または空配列でも書き込む関数）を足す。送信と現場単位の削除が成功したら、`task-records-*`・`worker-daily-records-*`・`all-task-records-*` を新しい内容（空を含む）で書き直す。`fromCache` で読んだ行には `fallback_insert` を付けない |
| **F0-2** | 読み込みに失敗すると、前の日付・現場の入力欄（record_id 付き）が残る。送るとその日の行が別の日の時刻で書き換わる | 316-446 の catch がログを出すだけで（438）、`tasks` を空にしない | 読み込みの effect の最初で `tasks` と `subcontractors` を空にする。失敗したら「読み込めなかった」状態にして送信を止め、`showToast` で知らせる |
| **F0-3** | 送信中に日付・現場・作業員の切替や下書きの復元ができ、送信後の処理（協力業者・実績・休憩・未保存フラグ）が切替後の画面に混ざる | `isSaving` で無効になるのは送信ボタン（2367）と休憩ボタン（1861）だけ | 送信中は日付・現場・作業員の切替と復元を無効にする。送信後の処理は、開始時の作業員・現場・日付が今と同じときだけ反映する |
| **F0-4** | 11 月の休憩「15・60・15 分」が 2026 年に限らず毎年 11 月に標準に読み替えられ、別の現場を送ったときに保存済みの時間も書き換わる | `workTimeUtils.ts:148-158`。`SEASON_RULES`（91-94）の新しい規則はこの先ずっと有効で、その前の規則と比べ続ける。design.md:482 は「2026 年 11 月」だけとしている | 読み替えは規則が切り替わった月（`from` の年月）だけにする。テスト: `2027-11-05` はそのまま、`2026-11-05` は読み替える、`2026-10-31` と `2026-12-01` はそのまま |
| **F0-5** | 時間数だけの行（管理者が時刻なしで入れたもの）が、選んでいる現場では 0h として数えられる。この現場の時間・人工・残業がずれ、「承認待ちに戻りました」も誤って出る | 1044-1048 で時刻の無い枠を 0 にしている。他の現場の分は `r.hours` で数える（63-72） | 読み込むときに、時刻の無い枠へ元の行の `hours` と `overtime_hours` を持たせ、計算に含める |
| **F0-6** | 他の現場の夜勤（22:00〜翌 02:00）が重複チェックで見落とされ、時間が二重に数えられる | `timeOverlapUtils.ts:94-106` は日をまたぐかどうかを推定しない | 日またぎの判定を 1 つの関数（`inferOvernight`）にまとめ、`buildOtherProjectIntervals` でも使う |
| **F0-7** | 承認申請の同期だけ失敗したときにも、下書きを消して未送信の印を外す | 1406-1407 で再送を促しているのに、1487-1488 で消している | `approvalSyncFailed` のときは下書きを残し、未送信の印も残す |
| **F0-8** | 休憩設定が読み込み中か読み込みに失敗した状態で送ると、保存済みの休憩設定が標準値で上書きされ、他の現場の時間も変わる | `handleSubmit` が `isLoadingBreakSettings` を見ていない | 休憩設定が読めていないときは送信を止める |
| **F0-9** | その日の全現場の実績の取得に、古い応答を捨てる仕組みが無い。作業員を切り替えると別の人の入力済みチップが出て、× で今の作業員の記録を消せてしまう | 254-266 に `active` フラグが無い | 他の effect と同じように `active` フラグを付け、対象が変わったら最初に空にする |

不具合ごとに再現テスト（純粋関数で書けるもの）を先に足す。フェーズ 1 以降は、ここで直した後の動きを「変えてはいけない動き」として扱う。

---

## 5. 分割後の構成

### 5.1 純粋関数（`src/utils/*.ts`）

| ファイル | 関数（元の行） |
|---|---|
| `dailyReportTasks.ts` | `inferOvernight`（69, 380, 852, 934, 1331 の重複を統一。開始と終了が同じときは false で DB に合わせる）／`newEmptySlot`（384, 864, 876, 1001, 1185 の重複）／`mapRecordsToTasks`（371-396。**`order` も持たせる**）／`updateSlotField`・`addSlot`・`removeSlot`（842-880）／`moveTask`（658-670）／`applyCopiedRecords`（912-950）／`clearTaskInputs`（1183-1189）／`buildNewTask`（999-1003） |
| `dailyReportCalc.ts` | `calculateTasksWithHours`（1042-1059）／`resolveEffectiveBreakDurations`（1038-1041）／`sumOtherProjectsHours`（63-72）／`computeDayTotals`（1578-1588）／`buildForemanSummary`（1591-1607）／`formatBreakSummary`（1490-1493）／`breakOptionsFor`（1848-1850） |
| `dailyReportSubmit.ts` | `validateDailyReport`（1222-1248。エラー文の配列を返す）／`buildSaveDailyReportPayload`（1262-1391）／`applySaveResultToTasks`（1394-1445）／`shouldWarnOvertimeReapproval`（1408-1414）／`slotKey` |
| `workerAppSelectors.ts` | `chooseStaffWorker`（198-209）／`isForemanOf`（419, 498, 533, 975, 1259, 1575 の 6 か所。ID は `String()` でそろえる）／`foremanProjectIds`／`canAddTask`／`buildProjectOptions`（2003-2006）／`shouldDeselectLegacyLeaveProject`（307-313）／`getEnteredProjects`（1881, 1920）／`formatApprovalNotice`／`buildLogoutMessage`（583-591, 603-611） |
| `draftRestore.ts` | `buildPendingRestore`（1100-1107）／`consumePendingRestore`（278-284, 325-331。ref を書き換える代わりに「次の状態」を返す） |
| `dailyReportForm.ts` | reducer と action（§5.2） |

ほかに次の整理をする。

- `COMPANY_TASK_PROJECT_NAME` と `LEGACY_LEAVE_PROJECT_NAMES`（58-60）は `constants.js` に移す。同じ名前の配列が `scheduleDisplay.js:11`、`useAssignmentState.js:457`、`useDashboardStats.js:77` にも別々にあるので、そろえて参照させる。
- 分を「H:MM」にする処理（1610-1611）は `timeOverlapUtils` の `formatMinutes` を使う。曜日（1743）は `dateUtils.getDayOfWeek`、`shiftDateStr`（1614-1618）は `dateUtils.addDays` を使う。
- `round2` が 3 か所にあるので 1 つにまとめる。

### 5.2 入力フォームの reducer（`dailyReportForm.ts`）

対象にする state は `tasks`、`subcontractors`、`deletedSubcontractorIds`、`overtimeReason`、`hasUnsavedChanges`（reducer の中では `isDirty`）の 5 つ。今は `setHasUnsavedChanges(true)` を 13 か所で手で呼んでいる。どの action で未保存になるかを reducer の中で決めれば、付け忘れが起きない。現在時刻やランダムな ID は action の中身として渡し、reducer は純粋に保つ。

| action | 未保存の印 | 元の行 |
|---|---|---|
| `LOADED` | 外す。削除予定の ID も空にする | 400-405 |
| `OVERTIME_REASON_LOADED` | 変えない | 412, 415 |
| `RESET` | 外す（作業員の切替） | 575-576 |
| `RESTORED_FROM_DRAFT` | 付ける | 1111-1121 |
| `TASK_FIELD_CHANGED` / `SLOT_FIELD_CHANGED` / `SLOT_ADDED` / `SLOT_REMOVED` | 付ける | 651, 842-880 |
| `TASKS_REORDERED` | **変えない**（今も並び替えでは付けない） | 658-670 |
| `PREVIOUS_DAY_COPIED` / `TASK_ADDED` | 付ける | 923-952, 999-1004 |
| `PROJECT_DAY_CLEARED` | 外す。残業理由も空にする | 1183-1191 |
| `SUBCONTRACTOR_ADDED` / `_CHANGED` / `_REMOVED` | 付ける（`temp-` で始まらない ID は削除予定に入れる） | 963-969 |
| `OVERTIME_REASON_CHANGED` | 付ける | 2309 |
| `SUBMIT_SUCCEEDED` / `SUBCONTRACTORS_REFRESHED` | 変えない | 1433-1457 |
| `MARK_DIRTY` / `MARK_CLEAN` | 休憩の変更・日付や現場の切替・送信の完了で使う | 1150, 1628, 1488 |

並び替えの保存（`saveTaskOrder`）は今は setState の更新関数の中で呼んでいる（667）。分割後は `actions.reorder` の中で「最新の tasks → `moveTask` → dispatch → `saveTaskOrder`」の順に処理する。

休憩設定・ドラッグの状態・承認一覧は reducer に入れず、それぞれのフックの `useState` のままにする。

### 5.3 フックとコンポーネント

**フック（`src/hooks/*.js`）**

| フック | 戻り値の要点 | 元の行 |
|---|---|---|
| `useWorkerSession` | `loggedInWorker`, `workers`, `projects`, `hourlyWage`, `switchWorker`, `clearWorker` | 86-98, 172-233 |
| `useOnlineStatus` | `isOnline` | 139, 235-249 |
| `useDraftQueue` / `useDraftAutosave` | 下書きの一覧と保存・削除。自動保存 | 137, 1011-1035, 1077-1083 |
| `useWorkerDayRecords` | その日の全現場の実績と `refresh` | 254-266 |
| `useDailyBreakSettings` | 実際に使う休憩、読み込み中か、変更、`applyRestored` | 269-303, 1139-1151 |
| `useRestoreCoordinator` | 復元の受け渡し（中身は `draftRestore.ts`） | 141-146 |
| `useDailyReportForm` | reducer の state と actions。読み込み | 316-417 ほか |
| `useForemanProjectData` | 職長用の集計 | 419-437 |
| `useApprovalNotices` / `useForemanApprovals` | お知らせ。残業と作業手当の承認（同じ形の 2 系統を 1 つにまとめる） | 460-561 |
| `useTaskDragReorder` | ドラッグの状態とハンドラ | 673-840 |
| `useReportPdfExport` | `exportPdf`, `isExporting` | 624-648 |
| `useDailyReportSubmit` | `submit`, `isSaving`, `saveMessage` | 1216-1526 |
| `useUnsavedGuard` | `confirmDiscard`（567, 1623, 1940, 1992 の同じ確認を 1 つに） | — |

**コンポーネント（`src/components/worker/*.jsx`）**

`WorkerApp`（外枠。認証の分岐だけ）→ `WorkerReportScreen`（フックを組み立てる）→ `WorkerHeader` / `StaffWorkerSwitcher` / `DateNavigator` / `ApprovalNoticesBanner` / `DraftQueueBanner` / `BreakSettingsPanel` / `DailySummaryCard` / `EnteredProjectChips` / `TimeOverlapWarnings` / `ProjectSelector` / `ForemanDashboard` / `PendingApprovalList`（残業と作業手当を `kind` で分ける）/ `TaskCard` と `TimeSlotRow` / `OvertimeReasonCard` / `SubcontractorSection` / `SubmitFooter` / `PasswordChangeDialog`

一番深い受け渡しは Screen → TaskCard → TimeSlotRow の 3 段。`actions` を 1 つの props にまとめれば足りるので、Context は作らない。

### 5.4 分割するときに壊しやすい結合

| # | 結合 | 守ること |
|---|---|---|
| ① | **下書き復元の受け渡し**（最も危険）。復元処理（1097-1107）が `pendingRestoreRef` を書き、休憩の effect（278-284）と読み込みの effect（325-331）がそれぞれ自分の印を立てる。後から動いた側が null に戻す | 2 つの effect に同じ ref を共有させる。依存配列は変えない（たとえば `loggedInWorker` を `loggedInWorker?.id` にしない）。判定は `consumePendingRestore` の単体テストで固定する。StrictMode の二重実行でも壊れないことを手動確認 C で確かめる |
| ② | `restoreSeqRef` を使って古い応答を捨てる（287/292, 321/400/412/415） | 読み込みのフックと休憩のフックに同じ ref を渡す |
| ③ | `autosaveEpochRef` を自動保存・作業員の切替（574）・削除（1182）の 3 か所で共有している。日付や現場の切替は `setHasUnsavedChanges(false)` によるタイマーの解除に頼っている | `MARK_CLEAN` と日付の更新を同じイベントの中で行う（React 18 の自動バッチ処理で同じ描画にまとまるようにする） |
| ④ | `loggedInWorker*Ref`（92-97）を更新する effect が、お知らせの effect（473）より前に宣言されている | フックの中でも、ref を更新する effect を先に置く |
| ⑤ | ドラッグのリスナーは `reorderTasksRef` を通して最新の関数を呼ぶ | 同じ形のまま移す |
| ⑥ | `handleSubmit` は `tasks[i]` と `tasksWithCalculation[i]`、`slotCalcs[j]` の添字がそろっている前提で書かれている（1273, 1280） | 純粋関数でも、同じ配列から作ったものを渡す |
| ⑦ | 送信後の下書き削除（1487）は、送信を始めたときの現場と日付を使う | これは意図どおり。最新の値を使うように「直さない」 |
| ⑧ | `isLoading` 1 つを起動時の読み込み・現場の読み込み・作業項目の追加で使い回している（1558 の分岐を兼ねる） | フェーズ 2 では「どれか 1 つでも読み込み中」という合成値にして動きを合わせる。分けるのはフェーズ 4 |

### 5.5 先にテストで固定する項目（フェーズ 1）

1. `buildSaveDailyReportPayload`（最優先）
   - 空にした既存の枠は削除に回る。時間数だけの行は残る。
   - メモは 1 枠目だけに付く。
   - 他の現場の時刻付きの記録は休憩を反映して計算し直す。削除予定・更新予定の ID は除く。
   - 協力業者は職長のときだけ送る。`temp-` の ID は `client_id` にして追加に回す。
   - 残業の合計は終業後の分だけで、早出は含めない。小数第 2 位に丸める。
2. `applySaveResultToTasks`: 追加した行の ID を書き戻す。消えていて追加し直した行は新しい ID に差し替える。
3. `calculateTasksWithHours`・`computeDayTotals`・`sumOtherProjectsHours`
   - 22:00〜02:00 は 4.0h。開始と終了が同じなら 0h。
   - 2026-10-31 は冬季、2026-11-01 は夏季。
   - 時間数だけの行を含めて計算する（F0-5）。
   - 人工の丸め: 7.49h → 1.0、7.875h → 1.1。
4. `validateDailyReport`: 時刻が片方だけ、開始と終了が同じ、16.0h は通る、16.01h は止まる、協力業者の人数が 0 や小数。
5. `consumePendingRestore`: 日付だけ違う・現場だけ違う・両方違う。2 回 consume したら null になる。
6. reducer: 各 action のあとの未保存の印。並び替えでは印が付かない。
7. `chooseStaffWorker`: 選ぶ順は `?workerId=` → 端末に保存した作業員（退職者は除く）→ 本人 → 名簿の先頭。

---

## 6. フェーズ 4: UI 改善の候補（採否はこれから決める）

現場利用者役（スマホ・手袋・屋外・電波が弱い・年配の職人と職長）の目で洗い出したもの。DB を変えずに入れられるものだけ。

| ID | 候補 | 効果 | 重さ | 優先 |
|---|---|---|---|---|
| U-1 | 職長の承認待ちを、どの現場を選んでいても見えるようにする。今は「選んだ現場の職長で、作業項目が 1 件以上あるとき」しか出ない（2031）。ヘッダーの下に「承認待ち N 件」の帯を常に出す | 大 | 小 | ★ |
| U-2 | 送信ボタンを 3 つの状態に分ける（未送信の変更あり／送信済み 17:42／送信中）。今は完了の表示が 5 秒で消える（1497-1498） | 大 | 小 | ★ |
| U-3 | 時刻入力に「定時」「午前」「午後」のワンタップを付ける。時の選択肢は朝の時間帯から並べる | 大 | 小〜中 | ★ |
| U-4 | トーストを画面上部に出す。今は送信ボタンに重なる（Toast.jsx:22） | 中 | 小 | ★ |
| U-5 | 押す場所を 44px 以上にする。危ないボタンを離す（現場チップの ×、時間帯の ×、「翌日」） | 中 | 小 | ★ |
| U-6 | 文字の下限を 13〜14px にし、薄い灰色の文字を濃くする | 中 | 小 | ★ |
| U-7 | 並び替えはグリップアイコンだけで始め、長押しを 500ms にする。今は見出しの全幅が `touchAction: none`（2176）でスクロールの邪魔になる | 中 | 小 | ★ |
| U-8 | 入力エラーは該当カードを赤い枠にし、最初のエラーまでスクロールする。トーストは 1 枚にまとめる | 大 | 中 | |
| U-9 | 下書きの欄を「まだ会社に届いていない日報 N 件」とし、「開いて送る」を主なボタンにする | 大 | 中 | |
| U-10 | オフラインの間は帯を出し、送信ボタンを「端末に保存（あとで送信）」にする | 大 | 中 | |
| U-11 | 画面の並びを「日付 → 現場 → 作業項目 → 休み・休憩 → 送信」にし、本日のまとめを 1 行に縮める | 大 | 中 | |
| U-12 | 時間を入れていない作業項目は 1 行に縮め、入力済みの項目を上に出す | 大 | 中 | |
| U-13 | 自分の残業・作業手当が「承認待ち」か「承認済み」かをバッジで出す（`dayOvertimeApproval` は取得しているのに表示していない） | 中 | 小〜中 | |
| U-14 | 承認ボタンを押したら確認を出すか、「元に戻す」を付ける。日付と時刻を「11/20(金) 17:00〜19:30」の形で出す | 中 | 小 | |
| U-15 | 休みの欄の未保存を印で示し、日付を移すときに確認を出す（今は黙って消える） | 中 | 小〜中 | |
| U-16 | 下書きが残っているときのログアウトの確認で、「先に送信する」を主なボタンにする | 中 | 小 | |
| U-17 | ヘッダーのアイコンを整理する。前日コピーは現場選択の下に文字付きで置き、ログアウトとパスワードはメニューにまとめる | 中 | 小 | |
| U-18 | エラー文に「どのボタンを押せばよいか」まで書く。PDF の失敗時に英語の原文を出さない（644） | 中 | 小 | |
| U-19 | 作業手当にチェックを入れたら「職長の承認待ちになります」と添える。進捗はボタンで選ぶ形にする | 小〜中 | 小 | |
| U-20 | 前日コピーの確認は、上書きになるときだけ出す | 小 | 小 | |

### フェーズ 4 で一緒に直す不具合・規約違反

| ID | 内容 | 根拠 |
|---|---|---|
| P4-1 | 起動直後の現場読み込みが空の `projects` を見る。職長のダッシュボードが 0 になり、共通現場の作業項目の自動作成も飛ばされる | 446 の依存配列に `projects` が無い |
| P4-2 | 作業項目を追加すると `order` が 1 になる（読み込み時に `order` を捨てている） | 386-395, 991。フェーズ 1 の `mapRecordsToTasks` で `order` を持たせれば直る |
| P4-3 | 読み込みの失敗が `console.error` だけになっている箇所がある | 227, 263, 438, 504, 539, 413-416 |
| P4-4 | 協力業者の人数欄が `min="0.1" step="0.1"` なのに、送信時は「1 以上の整数」しか通さない | 2348, 1243 |
| P4-5 | 「破棄」を選ぶ確認に `variant: 'danger'` が付いていないものがある | 1126, 1623, 1940, 1992、DayLeaveSection:130 |
| P4-6 | 「破棄して移動」を選んでも、自動保存の下書きは残る | 1621-1630 ほか |
| P4-7 | 通信エラーの下書きが、あとの自動保存で「自動保存」扱いになり、知らせが消える | 1011-1035 |
| P4-8 | 通信エラーの判定が Chrome の文言しか見ていない（iOS の "Load failed" を拾えない）。送信にタイムアウトが無い | `dailyReportSave.js:21-25` |
| P4-9 | PWA を翌朝そのまま再開すると、前日が選ばれたまま | 148 |
| P4-10 | 作業員の端末に現場の全列（金額・契約書の URL）を取得し、キャッシュにも残している | `useDailyReport.js:35-36` の `select('*')` |
| P4-11 | 日付ごとのキャッシュが増え続け、localStorage があふれると下書きの保存が黙って失敗する | `offlineCache.js:23-29`、420/425 で現場の全件をキャッシュ |
| P4-12 | 作業員向け配置表の 28 日分の取得がページ分けされておらず、1000 件で切れる | `useWorkerAssignments.js:51-59` |
| P4-13 | 担当者の代理入力の下書きに、ログインした人の記録が無い。セッションが切れて戻ったときに残る | `offlineCache.js:136-144`、`useAuth.jsx:166-170` |
| P4-14 | 季節名（`'夏季'`）と休憩名の直書き、DayLeaveSection の午前・午後の境目の直書き | 1824, 1491, 1851、DayLeaveSection:258 |
| P4-15 | 承認中に別の承認を押すと、1 件目の完了で 2 件目のボタンが押せるようになる | 163, 512-527 |
| P4-16 | 現場チップの切替が `<span onClick>` で、キーボードで操作できない。ラベルが select と結び付いていない | 1938, 1989, 2268, 2277 |
| P4-17 | 使われていない `isSyncingQueue` を消す | 140 |

### 仕様として確認したいこと（今回は直さない）

- 当日の 00:00〜05:00 は「早出」扱いになり、承認が要らない。前日の 22:00〜翌 05:00 と入れると残業になって承認が要る（`workTimeUtils.ts:264-272`）。仕様どおりかを確認したい。
- 作業員画面の「本日合計」は、他の現場の分も今の休憩設定で計算し直した値になっている。Excel・PDF は保存した値を足している。どちらを正とするか。
- 時間を枠ごとに小数第 2 位で丸めてから足している。20 分の枠が 3 つなら 0.99h になる（`workTimeUtils.ts:300`）。
- 1 日 16 時間を超えていないかのチェックが枠ごとで、1 日の合計は見ていない（1236）。

---

## 7. 手動確認の手順（A〜P）

フェーズ 0 で今の結果を記録しておき、各フェーズの最後に同じ手順で確かめる。

| # | 確認すること |
|---|---|
| A | ログインと作業員の決定。個人アカウントなら本人に固定される。担当者なら `?workerId=` で指定した作業員になり、前回選んだ作業員も復元される |
| B | 入力と送信。日をまたぐ時刻を入れると「翌日」が自動で付く。時間枠を追加・削除できる。送ったあとに開き直しても内容が残っている |
| C | 自動保存と復元。入力して 1 秒待ち、別の現場に移ると下書きのお知らせが出る。別の現場・別の日から復元しても、入力・休憩・残業理由が上書きされない |
| D | オフライン。DevTools でオフラインにして送ると下書きになる。オンラインに戻すと件数のトーストが出る |
| E | 記録の削除。現場チップの × で消すと、1 秒以上待っても下書きがよみがえらない |
| F | 作業員の切替。未送信の入力があれば確認が出る。切替後の作業員の名前で下書きが作られない |
| G | 前日の作業をコピー。時間数だけの行は残る。送っても二重に計上されない |
| H | 職長。ダッシュボードの値、進捗の保存、協力業者を 2 回続けて送っても二重にならない、残業と作業手当を承認できる |
| I | 休憩の変更。送ると、同じ日の他の現場の時間と残業も計算し直される。承認済みの残業時間が変わると警告が出る |
| J | 並び替え。長押しで動かせる。画面の端で自動スクロールする。開き直しても順番が保たれる |
| K | 承認のお知らせ。「確認した」で消える。代理入力中はボタンが出ない |
| L | 旧有給の現場。入力済みのチップからだけ開ける |
| M | 日報の PDF 出力 |
| N | ログアウト。個人アカウントは自分の下書きだけが消え、担当者は端末の下書きが全部消える |
| O | この日の休みの欄。入力でき、日付を切り替えるとその日の内容に戻る |
| P | localStorage のキー名が変わっていない（`cost-app-draft-queue`、`cost-app-cache-*`、`cost-app-worker:<uid>`、`cost-app-worker-project:<uid>`、`cost-app-worker-task-order-<pid>`） |

フェーズ 0.5 では、これに加えて F0-1〜F0-9 の再現手順を 1 つずつ確かめる。

---

## 8. 今回やらないこと

- 管理側（`DailyReportTab` / `InputTab`）の整理
- E2E テストと、Testing Library・jsdom の導入
- 下書きの自動再送（安全に入れるには DB 側の冪等キーが要る。§9 の DB-10）
- DB・RPC・RLS の変更（§9）

---

## 9. DB 側の改善案（今回は対象外。別に計画する）

画面側の修正だけでは塞げないもの。特に **DB-1〜DB-3 は権限の穴**なので、このリファクタリングとは別に早めに検討したい。

| ID | 内容 | 根拠 | 深刻度 |
|---|---|---|---|
| DB-1 | `TaskRecords` と休憩設定は、作業員の個人アカウントが他人の行も直接書き換えられる（RPC での本人の固定を素通りする） | `20260710002406:13-16` の `task_records_staff_all`（FOR ALL、worker も可）。後のマイグレーションでも変わっていない | 重要 |
| DB-2 | 作業員が全員分の日報・残業理由を API から読める | 同上、承認申請の SELECT | 重要 |
| DB-3 | 共有の worker アカウントは、名前と ID を申告すれば誰の日報でも書け、承認もできる | `_effective_worker`、`is_declared_foreman` | 本番に共有アカウントが残っていれば重要 |
| DB-4 | `save_daily_report` の削除と更新が、現場・日付で絞られていない（F0-2・F0-3 の被害を広げている） | `20261107020000:272-297` | 重要 |
| DB-5 | 楽観ロックが無く、最後に送った人の内容で上書きされる（管理者が直した進捗や時間が戻る） | 同 289-345 | 重要 |
| DB-6 | 承認の RPC が「職長が画面で見た値」を受け取らないので、見ていない時間で承認されうる | 同 485-493, 525-532 | 重要 |
| DB-7 | 休憩設定を日報の保存と同じトランザクションに入れる | `useDailyReport.js:141-150` が別のリクエストで保存している | 重要 |
| DB-8 | 振替元になっている日報を消しても、振休がそのまま残る | `delete_worker_project_day` | 軽微 |
| DB-9 | 現場の金額の列を、作業員と閲覧者には見せない | `20260710002254:9-11` | 重要 |
| DB-10 | 時間枠ごとに画面で作る UUID を持たせ、再送しても二重にならないようにする | 一意索引が `(worker_name, date, project_task_id, start_time)` しかない | 中 |
| DB-11 | 承認の差し戻しと取り消し | 今は `approve*` しかない | 中 |

本番の RLS・関数がマイグレーションどおりか（`pg_policies` / `pg_proc`）と、共有の worker アカウントが残っているかは、リポジトリからは確かめられない。

---

## 10. ドキュメントとコードの食い違い（規約により、コードを正とする）

| # | ドキュメント | 食い違い |
|---|---|---|
| 1 | CLAUDE.md「Supabase呼び出し」 | DB を呼んでよい `src/lib/` のモジュールに `approvalNotices.js` が載っていない（`WorkerApp.jsx:39` で使っている） |
| 2 | CLAUDE.md「主なファイル構成」 | `components/worker/` と `useDailyReport.js`・`useWorkerLeave.js`・`useWorkerAssignments.js` が載っていない |
| 3 | docs/design.md:482 | 休憩の読み替えは「2026 年 11 月」だけとあるが、コードは毎年 11 月に読み替える（F0-4 で直す） |
| 4 | docs/design.md:483 | 「保存済みの値は保存時のまま」とあるが、作業員画面では他の現場の保存値を計算し直す |
| 5 | docs/design.md:417-430 | データの流れの図が古い（実際は `useDailyReport` の関数、`fetchWithCache`、RPC `save_daily_report`） |
| 6 | docs/design.md:336 | `worker/` に `QuarterTimeSelect` と `DayLeaveSection` が無い |
| 7 | docs/design.md:391-415 | フック一覧・サービス層に `useDailyReport.js` が無い。`useWorkerAssignments` の説明が実際と違う |
| 8 | docs/design.md:589 | `src/lib/` を「外部ライブラリの初期化」としているが、DB を操作するモジュールがある |
| 9 | docs/design.md:101 と 693 | 承認を行う画面が、作業員画面と `DailyReportTab` で食い違っている（コードは作業員画面） |
| 10 | docs/design.md:692 | 日報スキーマを変えたときの影響範囲に `useDailyReport.js` と `save_daily_report` が無い |
| 11 | docs/design.md:122 | 「施工中のみ表示」とあるが、社内業務と旧有給の現場も出る |
| 12 | docs/design.md:679 | Vitest の対象が `*.test.ts` だけになっているが、`.test.js` も動く |
| 13 | docs/manuals/worker-manual.md | ボタン名（「今日の実績を送信」→ 実際は「実績を送信」）、完了の文言、下書きの説明（入力中も自動保存する）、時刻の入れ方（時・分のプルダウン）が違う。前日コピー・休憩設定・残業理由と承認・作業手当・並び替え・PDF 出力・配置表・代理入力の切替などが書かれていない |
| 14 | コードのコメント | `draftQueueUtils.ts:24-26` と `useDailyReport.js:230` が、今は使っていない「共有アカウントで名前を選ぶ」前提で書かれている。`useDailyReport.js:234` の JSDoc に `approvalSyncFailed` が無い |
