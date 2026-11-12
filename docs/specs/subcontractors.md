# 下請け会社の正式管理 設計書

> ステータス: **設計合意済み・未実装**（2026-11-12）。サブエージェントのレビュー（2026-11-12）を受け、配置表を軽量案（§2 #13）に変更し、§6 の権限の事実誤認を訂正した。レビュー指摘への対応はすべて決定済みで、§9 にまとめている。

## 1. 背景と目的

現状、下請け会社（㈲菊池塗装工業所・㈲藤澤塗装）は次のように暫定運用されている。

- `Workers` の 1 行として登録し、配置表（`Assignments.workerId`）に出している（工程表で配置を可視化するため）。
- 日報の人数は、職長が `WorkerApp` で会社名を自由記述し、人数を入力して `SubcontractorRecords` に保存している。単価は 0 で保存され、管理者が後から入れる。

問題点:

- `Workers` に社員／下請けを区別する列がなく、時給・入社日・ログイン等の社員向けロジックに下請けが混ざる。
- 配置表の会社（`Workers`）と日報の会社（`company_name` 自由記述）がつながっておらず、表記ゆれで突合できない。
- 契約形態が「常用」（人工 × 単価）と「請負」（工事ごとの固定金額）の 2 種あるが、現行の `協力業者費 = Σ(人数 × 単価)` は常用しか表せない。

目的: 下請け会社をマスタ化し、契約形態を区別して原価・配置表に正しく反映する。

## 2. 設計判断（合意事項）

| # | 論点 | 決定 |
|---|------|------|
| 1 | 下請けの単位 | 「会社」1 行。会社所属の個人は管理しない |
| 2 | 正本 | 新テーブル `Subcontractors`（会社・単価・契約の正本）。ただし配置表用の行は `Workers` に残す（#13） |
| 3 | 単価 | 会社マスタに標準単価を持ち、契約（記録）側で上書き可。記録作成時にコピーするので過去の原価は変わらない |
| 4 | 契約形態の単位 | 「現場 × 会社」の契約 `SubcontractContracts`（同じ会社でも現場により常用／請負を使い分けられる） |
| 5 | 契約が未登録のときの日報入力 | 入力を止めない。暫定契約（常用・標準単価・要確認）を自動作成 |
| 6 | 原価の計上単位 | **現場単位**（工種には紐づけない。現行の常用の集計と一致） |
| 7 | 配置表の予定人数 | `Assignments.planned_count`（NULL 可）を追加。管理者画面のみ表示 |
| 8 | 移行 | 1 回限りの SQL（対象は現状 2 社）。配置の付け替えは不要（#13） |
| 9 | 公開範囲 | 匿名の工程表は既存の `get_public_schedule` RPC を拡張して会社名を返す（新しい匿名ビューは作らない）。金額系は管理者のみ |
| 10 | 管理画面 | 会社マスタは `MasterTab`、契約は案件詳細画面 |
| 11 | 同じ現場・同じ会社の複数契約 | 許す。「請負 → 完了後に常用」の運用があるため。常用は 1 現場 1 会社 1 件まで、請負は複数可 |
| 12 | 契約の振り分け方 | 請負契約に期間（開始日・終了日）を持たせ、日報の人数は**日付で自動判定**する。職長は契約を選ばない |
| 13 | 配置表の改修方針 | **軽量案**。配置表は `Assignments.workerId` のまま動かす。`Workers.subcontractor_id`（NULL 可・UNIQUE）で、下請け会社の配置行を `Subcontractors` と 1 対 1 に紐づける。配置行の名前・表示順は `Subcontractors` が正本で、`Workers` 側へ同期する。配置表の全面改修（`Assignments.subcontractor_id`、セルキーの再設計など。目安 2〜3 週間級）は見送り、将来の課題とする |

出来高・支払いの管理（請負の進捗率、支払い済み金額）は**今回の対象外**。

## 3. テーブル設計

### 3.1 Subcontractors（新設）

| カラム | 型 | 説明 |
|--------|----|------|
| id | int8 PK | |
| created_at | timestamptz | |
| name | text NOT NULL UNIQUE | 会社名（例: ㈲菊池塗装工業所） |
| standard_unit_price | numeric NOT NULL DEFAULT 0 | 標準単価（円/人工） |
| display_order | int8 | 表示順 |
| show_in_assignment | bool NOT NULL DEFAULT true | 配置表に表示するか |
| active | bool NOT NULL DEFAULT true | 取引停止後は false |

### 3.2 SubcontractContracts（新設）

| カラム | 型 | 説明 |
|--------|----|------|
| id | uuid PK | |
| created_at | timestamptz | |
| project_id | int4 NOT NULL | 現場 |
| subcontractor_id | int8 NOT NULL | 会社 |
| type | text NOT NULL | `常用` / `請負`（定数化する。後述） |
| unit_price | numeric | 常用の単価（請負は NULL） |
| contract_amount | numeric | 請負の契約金額（常用は NULL） |
| scope | text | 工事内容（請負） |
| start_date | date | 請負の開始日（請負は必須、常用は NULL） |
| end_date | date | 請負の終了日。NULL は「請負が継続中」 |
| needs_review | bool NOT NULL DEFAULT false | 日報から自動作成された暫定契約（常用） |

制約:

- `type = '常用'` なら `unit_price IS NOT NULL`、`type = '請負'` なら `contract_amount IS NOT NULL` かつ `start_date IS NOT NULL`（CHECK）。
- 常用は `(project_id, subcontractor_id)` で 1 件まで（部分 UNIQUE インデックス、`WHERE type = '常用'`）。
- 同じ現場・同じ会社の請負の期間は重ならない（EXCLUDE 制約またはトリガーで検証）。
- `end_date >= start_date`（CHECK）。

### 3.3 既存テーブルの変更

| テーブル | 変更 |
|----------|------|
| `Workers` | `subcontractor_id int8`（NULL 可、`Subcontractors.id` への FK、UNIQUE）を追加。値がある行は下請け会社の配置行、NULL は社員。名前・表示順・`show_in_assignment` は `Subcontractors` から同期する（トリガー等） |
| `Assignments` | `planned_count numeric`（NULL 可）を追加するのみ（`workerId` はそのまま）。定義: 1 会社・1 日・1 現場につき 1 行、その行の人数。ドラッグコピーでも `planned_count` をコピーする |
| `SubcontractorRecords` | `subcontractor_id int8` を追加（移行期間は NULL 可）。`company_name` は表示用に残す。契約への紐づけ（`contract_id`）は**持たず**、集計時に日付から判定する（§4） |

### 3.4 公開経路

- **匿名の工程表:** 既存の `get_public_schedule`（トークン照合付き SECURITY DEFINER RPC、列を明示列挙）を拡張する。下請けの配置行が `Workers` に残るので、配置の返却は既存のままで足りる。追加するのは、必要なら `subcontractor_id` の有無程度。`planned_count`・単価・契約は返さない。**新しい匿名向けビューは作らない**（匿名にテーブル・ビューへの直接アクセスを許さない `security-permissions.md` の方針に合わせる）。
- **認証ユーザー（作業員・閲覧者を含む）:** `workers_directory` に `subcontractor_id` を追加し、社員向け一覧は `subcontractor_id IS NULL` で絞る。

## 4. 原価計算

```
協力業者費 = Σ(常用の記録人数 × 契約の単価) + Σ(請負契約の contract_amount)
予測損益   = Σ工種の予測損益 − 協力業者費
```

- 日報の人数記録の振り分けは、**記録の日付**で判定する。同じ現場・同じ会社の請負契約の期間（`start_date`〜`end_date`、`end_date` が NULL なら現在まで）に含まれる日は請負、それ以外は常用。
  - 請負の期間内の人数は、配置の把握用に保存するが、原価には算入しない（二重計上防止）。
  - 期間外の人数は、常用として `人数 × 記録の単価` を原価に加える。
  - 請負契約を後から登録・変更しても、過去の記録は日付で判定し直される。
- 請負金額は、契約登録時に全額を計上する。工種別損益には影響しない。
- 記録時の単価は、記録（`SubcontractorRecords.unit_price`）にコピーして保持する（常用の過去原価を、後の単価変更から守る）。

## 5. 入力フロー

### 5.1 職長の日報（WorkerApp）

1. 会社マスタ（`Subcontractors`）から会社を選び、人数を入力する。自由記述は廃止する。
2. 保存時、その現場とその会社の**常用契約**がなければ、DB 側の RPC が暫定契約（常用・標準単価・`needs_review = true`）を作成する。記録の単価には契約の単価をコピーする。請負か常用かは日付で自動判定されるので、職長は契約を選ばない。
3. 職長には単価・契約金額を見せない。

運用上の注意: 請負契約の開始日を入れ忘れると、請負の作業日の人数が常用として原価に載る。請負契約は開始日を必須とし、終了日は完了時に入れる（NULL の間は継続中）。「請負が継続中の会社に、請負期間外の常用記録が混じっている」警告は、今回の対象外。

### 5.2 管理者

- **会社マスタ:** `MasterTab` に「下請け会社」セクションを追加する（社名・標準単価・表示順・配置表表示）。
- **契約:** 案件の詳細画面に「協力業者契約」欄を追加する（常用／請負、単価、請負金額、工事内容）。暫定契約には「要確認」バッジを出し、案件画面で確定する。

### 5.3 配置表

- 下請けの行は、これまでどおり `Workers` の配置行（`subcontractor_id` あり）として表示する。セルには予定人数（`planned_count`）を入力でき、日報の実績人数と並べて見られる。
- 予定と実績の差のアラートや集計は今回の対象外。

## 6. 権限（RLS）

| 対象 | 管理者 | 職長・作業員 | 匿名（工程表閲覧） |
|------|--------|--------------|--------------------|
| `Subcontractors` | 読み書き | 名前・表示用の列のみ（標準単価は見せない。安全列のビュー経由） | 不可 |
| `SubcontractContracts` | 読み書き | 不可（暫定契約の作成と、損益用の協力業者費合計は RPC 経由） | 不可 |
| `SubcontractorRecords` | 読み書き | 人数・会社・日付のみ（`unit_price` は見せない。現行は worker ロール全員が全行 SELECT 可で、単価も見える: `20261105010000_daily_report_integrity_rpcs.sql`） | 不可 |
| 匿名の工程表 | — | — | `get_public_schedule` RPC のみ（会社名・配置まで） |

事実の訂正（レビューで確認）: `Assignments` は匿名では読めない（admin/office は ALL、worker/viewer は SELECT のみ。`20260710002406_phase2_remaining_tables_rls.sql`）。匿名の工程表は `get_public_schedule` 経由で、列を明示列挙している。`planned_count` が漏れる相手は、`select('*')` で `Assignments` を読む worker / viewer ロールと作業員画面（`useWorkerAssignments.js`）で、これらの扱いは §9 で決める。

## 7. 移行

1 回限りの SQL（`supabase/migrations/` に置く）。

1. `Workers` の下請け行（㈲菊池塗装工業所・㈲藤澤塗装）から `Subcontractors` を作り、その `Workers` 行の `subcontractor_id` に紐づける。`Assignments` の付け替えは不要（配置はそのまま動く）。旧 `Workers` 行は削除しないので、配置が二重に出る問題もない。
2. `SubcontractorRecords.company_name` を名寄せし `subcontractor_id` を埋める。一致しないものは NULL のまま残し、管理画面に「未紐づけ」として表示する。名寄せの規則（㈲／有限会社、全角半角の揺れ）は実装時に書く。
3. 既存の記録には、現場×会社ごとに常用契約を 1 件作る（単価の決め方は §9）。`needs_review = true`。請負は、管理者が後から登録する。

実行前に確認すること:

- `Workers` を参照する外部キーは `Assignments.workerId`、`estimates.created_by`、`InventoryItems.worker_id`、`Projects.foreman_worker_id`、`WorkerCertifications.workerId`（`src/types/supabase.ts` より）。2 社の行はそのまま残るので壊れないが、FK 以外の参照（`TaskRecords.worker_name`、`Workers.auth_user_id`、LINE WORKS 通知）が付いていないかを、移行前に SELECT で確認する。
- `btree_gist` 拡張が必要（請負期間の排他制約に使う場合）。

## 8. 実装範囲

- マイグレーション（テーブル・ビュー・RLS・RPC・移行 SQL）
- `src/hooks/` に下請け会社・契約のフック（または `useSubcontractors.js`）。UI から直接 `supabase.from()` は呼ばない
- `utils/constants.js` に契約形態の定数（`CONTRACT_TYPE.JOYO` / `CONTRACT_TYPE.UKEOI` 等）を追加
- `utils/projectUtils.js` の原価集計を、契約形態別に変更
- `WorkerApp.jsx` の協力業者入力を、会社選択に変更
- `MasterTab.jsx`、案件詳細画面、配置表（予定人数の入力・表示のみ）、`ScheduleViewApp.jsx`
- 社員向け一覧からの下請け行の除外（`workers_directory` に `subcontractor_id` を追加し、名簿・残業承認・在庫の担当者選択などで `subcontractor_id IS NULL` に絞る）
- 管理者側の協力業者入力（`InputTab.jsx`、`useProjects.js`）の会社選択化
- 日報保存 RPC `save_daily_report`（最新は `20261107020000`）の改修（暫定契約の自動作成は `ON CONFLICT DO NOTHING`。旧下書き・旧バンドルが `company_name` で再送しても受け付けて名寄せする）
- 原価計算の呼び出し元（`projectUtils.js`、`useDashboardStats.js`、`WorkerApp.jsx`）への契約の受け渡しと、`useSupabaseData.js` の 2 か所の契約の取得
- `delete_project` RPC の FK（`SubcontractContracts.project_id` は `ON DELETE CASCADE`）。`get_project_ninku_summary` の人工の扱い（下請け配置行を含めるかを確認）
- 職長向けの協力業者費合計 RPC の新設と、職長画面の損益表示の差し替え。worker ロールから単価列を隠す RLS／ビューと、`useDailyReport.js` の取得列の絞り込み
- Excel / PDF の会社名の出力（`company_name` を書き込み側でも必ず埋める）
- `projectUtils.test.js` と `projectUtils.test.ts` の併存の整理
- `docs/design.md` §3 と `specs/database.md`、`specs/security-permissions.md`、マニュアル類の更新
- テスト: `projectUtils` の原価集計（常用・請負・暫定契約）、RLS の確認

## 9. 未決事項とレビュー指摘への対応

レビュー（2026-11-12）で出た指摘は、以下 1〜5 のとおりすべて決定済み（取り消し線の項目）。

1. ~~**職長への単価・損益の見せ方（高）。**~~ **決定済み: A 案。** 単価・契約は職長に見せない。職長の予測損益は、DB の RPC（SECURITY DEFINER）が現場ごとの協力業者費の合計（常用 + 請負）だけを返し、職長画面（`WorkerApp.jsx:1553-1564`）はそれを使う。`SubcontractorRecords` と `Subcontractors` の単価列は、worker ロールから読めないようにする（既存の `workers_directory` 方式に合わせ、安全列のビュー経由にする。`select('*')` の取得箇所 `useDailyReport.js:64-78` は列指定に直す）。実装範囲は §8 に追記済み。
2. ~~**暫定契約の単価確定時の過去記録の扱い（高）。**~~ **決定済み: B 案。** 記録へのコピー（`SubcontractorRecords.unit_price`）は維持する。暫定契約の単価を「確定」した時点（`needs_review` を false にする操作）で、その契約の対象記録（その現場・その会社の常用の記録）の `unit_price` を一括更新する。確定後に作られる記録は新しい単価をコピーし、確定後の単価改定は新しい記録にだけ効く。標準単価が 0 の会社の暫定契約には「単価未設定」の警告バッジを出す。確定操作は DB 側の RPC で行い、契約の更新と記録の更新を 1 トランザクションにする。移行時の単価の決め方（同じ現場・同じ会社で単価が複数あるとき、0 が混ざるとき）は、「最新の非 0 単価、なければ 0 のまま暫定（単価未設定バッジ付き）」とする。
3. ~~**`planned_count` の worker / viewer への公開可否（高）。**~~ **決定済み: A 案。** DB では制限しない（`Assignments` の `select('*')` はそのまま）。管理者画面の配置表にだけ表示し、作業員・閲覧者の画面には表示を出さない。匿名の工程表（`get_public_schedule`）には含めない。
4. ~~**日付判定の境界条件（中）。**~~ **決定済み:**
   1. 請負期間は開始日・終了日の両日を含む（閉区間）。1 日だけの請負も許す。隣り合う請負（前の終了日の翌日が次の開始日）は重複扱いにしない（排他制約は `daterange(start_date, COALESCE(end_date,'infinity'), '[]')`）。
   2. `end_date` が NULL は「請負が継続中」。以降の記録はすべて請負扱いで原価に載らない。
   3. 終了日の入れ忘れの警告は今回は入れない。代わりに、終了日が NULL の請負契約には、契約欄に「継続中」バッジを常に表示する。
   4. 契約の削除・期間の変更の前に `useConfirm()` で影響件数（「N 件の記録の扱いが変わります」）を表示して確認する。
   5. `subcontractor_id` が NULL の旧記録は常用として計上する（記録の `unit_price`）。管理画面に「未紐づけ」と表示する。
   6. 同じ日・同じ会社の複数記録は、記録単位で判定する（合算が必要な表示は集計時に合算する）。
   7. 判定は純関数 `classifySubcontractorRecords(records, contracts)` に切り出し、上記の境界を単体テストで確認する。
5. ~~**型・制約の細部（低）。**~~ **実装時に次のとおり進める（決定事項として確定）:** `SubcontractContracts.project_id` は他テーブルに合わせて bigint とし、`REFERENCES "Projects"(id) ON DELETE CASCADE` を付ける。`type` は DB に CHECK（`IN ('常用','請負')`）を入れ、`CONTRACT_TYPE` 定数と値を一致させる。`contract_amount`・`unit_price`・`standard_unit_price` には `CHECK (>= 0)`、UI は `min="0"`。名寄せの規則は実装時に書く。新規 UI は `CLAUDE.md` の規約（アイコンボタンの `aria-label` と `title`、`useConfirm()`、`showToast`）に従う。`Subcontractors` 削除時は、参照する契約や `Workers.subcontractor_id` がある場合は削除させず、`active = false` にする運用とする。

将来フェーズ（今回は対象外と決定）: 請負の出来高・支払い管理。請負金額は契約登録時に全額を原価計上し、支払い管理は別の仕組み（購買台帳など）で行う。必要になった時点で `SubcontractPayments` 等を `SubcontractContracts` に紐づけて追加する。

## 10. ドキュメントとコードの食い違い（確認済み）

- `specs/database.md` の `Workers` に `show_in_assignment` がないが、コード（`useWorkers.js`、`workers_directory`）は使っている。
- `design.md` の `協力業者費 = Σ(人数 × 単価)` は常用のみの式で、請負はドキュメントにもコードにもない。本設計で拡張する。
- 設計書（初版）の「`Assignments` は匿名でも読める」は誤り。実際は認証済みユーザーのみで、匿名は `get_public_schedule` 経由（§6 で訂正済み）。
- 設計書（初版）の「職長は自分が入力した範囲のみ」は現行ポリシーと不一致（現行は worker ロール全員が全行 SELECT 可）。
- 設計書（初版）の「記録の単価に契約単価をコピー」は、現行 RPC が `unit_price` を 0 固定で保存する実装と食い違う。RPC の改修が必要（§8）。
