# 下請け会社の正式管理 設計書

> ステータス: **設計合意済み・未実装**（2026-11-12。未決事項はすべて解消）

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
| 2 | 正本 | 新テーブル `Subcontractors`（`Workers` に区別列を足す案は不採用） |
| 3 | 単価 | 会社マスタに標準単価を持ち、契約（記録）側で上書き可。記録作成時にコピーするので過去の原価は変わらない |
| 4 | 契約形態の単位 | 「現場 × 会社」の契約 `SubcontractContracts`（同じ会社でも現場により常用／請負を使い分けられる） |
| 5 | 契約が未登録のときの日報入力 | 入力を止めない。暫定契約（常用・標準単価・要確認）を自動作成 |
| 6 | 原価の計上単位 | **現場単位**（工種には紐づけない。現行の常用の集計と一致） |
| 7 | 配置表の予定人数 | `Assignments.planned_count`（NULL 可）を追加。管理者画面のみ表示 |
| 8 | 移行 | 1 回限りの SQL（対象は現状 2 社） |
| 9 | 公開範囲 | 公開ビューは最小列のみ。金額系は管理者のみ |
| 10 | 管理画面 | 会社マスタは `MasterTab`、契約は案件詳細画面 |
| 11 | 同じ現場・同じ会社の複数契約 | 許す。「請負 → 完了後に常用」の運用があるため。常用は 1 現場 1 会社 1 件まで、請負は複数可 |
| 12 | 契約の振り分け方 | 請負契約に期間（開始日・終了日）を持たせ、日報の人数は**日付で自動判定**する。職長は契約を選ばない |

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
| `Assignments` | `subcontractor_id int8` と `planned_count numeric`（NULL 可）を追加。`workerId` との排他を CHECK で保証（どちらか一方のみ） |
| `SubcontractorRecords` | `subcontractor_id int8` を追加（移行期間は NULL 可）。`company_name` は表示用に残す。契約への紐づけ（`contract_id`）は**持たず**、集計時に日付から判定する（§4） |

### 3.4 公開ビュー subcontractors_directory

`id, name, display_order, show_in_assignment` のみ。工程表閲覧（認証なし）はこのビューから会社を読む。単価・契約は含めない。

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

- 下請けの行は `Subcontractors` から表示する。セルには予定人数（`planned_count`）を入力でき、日報の実績人数と並べて見られる。
- 予定と実績の差のアラートや集計は今回の対象外。

## 6. 権限（RLS）

| 対象 | 管理者 | 職長・作業員 | 匿名（工程表閲覧） |
|------|--------|--------------|--------------------|
| `Subcontractors` | 読み書き | 読み取り（名前・表示用） | 不可（公開ビュー経由） |
| `SubcontractContracts` | 読み書き | 不可（RPC 経由で暫定契約の作成のみ） | 不可 |
| `SubcontractorRecords` | 読み書き | 自分が入力した範囲の人数のみ。単価は見えない | 不可 |
| `subcontractors_directory`（ビュー） | 読み取り | 読み取り | 読み取り |

注意: `Assignments` は匿名でも読める現状のため、`planned_count` を追加すると漏れる。工程表閲覧は列を絞った取得（またはビュー）に切り替える。具体的なポリシーは `specs/security-permissions.md` の方式に合わせて実装時に設計する。

## 7. 移行

1 回限りの SQL（`supabase/migrations/` に置く）。

1. `Workers` の下請け行（㈲菊池塗装工業所・㈲藤澤塗装）から `Subcontractors` を作る。
2. その `workerId` を指す `Assignments` を `subcontractor_id` に付け替える。
3. `SubcontractorRecords.company_name` を名寄せし `subcontractor_id` を埋める。一致しないものは NULL のまま残し、管理画面に「未紐づけ」として表示する。
4. 既存の記録には、現場×会社ごとに常用契約を 1 件作る（単価は既存記録の `unit_price`。`needs_review = true`）。請負は、管理者が後から登録する。
5. 旧 `Workers` の下請け行は、確認が済むまで残す（戻せるようにする）。

実行前に確認すること:

- 2 社の `Workers.id` が、`Assignments` 以外から参照されていないか。`Workers` を参照する外部キーは `Assignments.workerId`、`estimates.created_by`、`InventoryItems.worker_id`、`Projects.foreman_worker_id`、`WorkerCertifications.workerId`（`src/types/supabase.ts` より）。移行 SQL の冒頭で、この 2 社の ID が `Assignments` 以外から参照されていれば中断するガードを入れる。旧 `Workers` の行は移行で削除しないため、参照があっても壊れない。

## 8. 実装範囲

- マイグレーション（テーブル・ビュー・RLS・RPC・移行 SQL）
- `src/hooks/` に下請け会社・契約のフック（または `useSubcontractors.js`）。UI から直接 `supabase.from()` は呼ばない
- `utils/constants.js` に契約形態の定数（`CONTRACT_TYPE.JOYO` / `CONTRACT_TYPE.UKEOI` 等）を追加
- `utils/projectUtils.js` の原価集計を、契約形態別に変更
- `WorkerApp.jsx` の協力業者入力を、会社選択に変更
- `MasterTab.jsx`、案件詳細画面、配置表、`ScheduleViewApp.jsx`（公開ビューへの切替）
- `docs/design.md` §3 と `specs/database.md`、`specs/security-permissions.md`、マニュアル類の更新
- テスト: `projectUtils` の原価集計（常用・請負・暫定契約）、RLS の確認

## 9. 未決事項（実装前に確認）

なし（すべて決定済み）。

将来フェーズ（今回は対象外と決定）: 請負の出来高・支払い管理。請負金額は契約登録時に全額を原価計上し、支払い管理は別の仕組み（購買台帳など）で行う。必要になった時点で `SubcontractPayments` 等を `SubcontractContracts` に紐づけて追加する。

## 10. ドキュメントとコードの食い違い（確認済み）

- `specs/database.md` の `Workers` に `show_in_assignment` がないが、コード（`useWorkers.js`、`workers_directory`）は使っている。
- `design.md` の `協力業者費 = Σ(人数 × 単価)` は常用のみの式で、請負はドキュメントにもコードにもない。本設計で拡張する。
