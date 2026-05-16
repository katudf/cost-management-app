# 見積書管理へのExcelインポート機能追加

見積書管理（EstimateList）にExcelデータの忠実な読み込み機能を追加します。工事設定タブの既存インポート処理（`parseExcelForImport`）を活用しつつ、AIや手動の項目選択は行わず、元データをそのまま見積書の明細として取り込みます。

## 要件の整理

### 工事設定タブ（既存）との違い
| 項目 | 工事設定タブ | 見積書管理（今回） |
|------|------------|-----------------|
| 目的 | 作業項目の抽出 | 見積原本の忠実な再現 |
| AI最適化 | ◯ あり | ✕ なし |
| 手動選択 | ◯ あり | ✕ なし（全件自動取り込み） |
| 保存先 | `ProjectTasks` テーブル | `estimates` + `estimate_items` テーブル |
| データ構造 | `task` + `target` + `estimatedAmount` | `name` + `spec` + `quantity` + `unit` + `unit_price` + `amount` |

### 元データの忠実な読み込みとは
現在の `parseExcelForImport` は以下のようにデータを加工しています：
- **C列**: 名称（`name`）
- **Y列**: 仕様（`spec`）→ 現在は `taskName` に結合
- **AO列**: 数量（`quantity`）
- **AR列**: 単位（`unit`）→ 現在は `taskName` に結合
- **AX列**: 金額（`amount`）→ 現在は `estimatedAmount` として保持

今回は、これらの個別フィールドを**そのまま分離して** `estimate_items` テーブルの各カラムにマッピングします。

## Proposed Changes

### Excel読み込みユーティリティの拡張

#### [MODIFY] [excelImportUtils.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/excelImportUtils.js)

新しい関数 `parseExcelForEstimate` を追加します。既存の `parseExcelForImport` はそのまま維持します。

- 元のExcelデータを忠実に個別フィールドとして抽出
  - `name`: C列（名称）
  - `spec`: Y列（仕様）
  - `quantity`: AO列（数量）
  - `unit`: AR列（単位）
  - `unit_price`: 金額÷数量で単価を逆算（もしくはExcel上に単価列があればそちら優先）
  - `amount`: AX列（金額）
- 工事名（`projectName`）、顧客名（`customerName`）も同様に抽出
- 「合計」「小計」「諸経費」「値引」行はスキップ（既存ロジックと同様）

---

### 見積書一覧へのインポートUI追加

#### [MODIFY] [EstimateList.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimateList.jsx)

ヘッダーの「新規作成」ボタンの横に「Excelから取込」ボタンを追加します。

- ファイル選択 → `parseExcelForEstimate` でパース
- パース結果を新規見積書として `estimates` テーブルに保存
- 明細データを `estimate_items` テーブルに保存
- 保存後、自動的にその見積書の編集画面（EstimateForm）に遷移

#### フロー
1. ユーザーが「Excelから取込」をクリック
2. ファイル選択ダイアログが開く
3. Excelファイルを選択
4. 即座にパース＆保存処理を実行（モーダル不要、確認画面不要）
5. 新規作成された見積書の編集画面に遷移
6. ユーザーが必要に応じて顧客、見積番号等を修正して保存

## Open Questions

> [!IMPORTANT]
> **単価列について**: 現在のExcelパースでは単価を直接読み取っていません。「金額÷数量」で単価を逆算する方針で問題ないでしょうか？それとも、Excel上に単価の列が存在する場合はそちらの列位置を教えてください。

> [!IMPORTANT]
> **工種（カテゴリ）の扱い**: 見積書の明細には「工種」行が存在します。Excelの元データにも工種の区切りがある場合、それを `item_type: 'category'` として取り込むべきでしょうか？現時点では全て `item_type: 'item'` として取り込み、後からユーザーが工種を手動で追加する方針を想定しています。

## Verification Plan

### 動作確認
1. 見積書一覧画面に「Excelから取込」ボタンが表示されることを確認
2. Excelファイルを選択し、パース→保存が正常に完了することを確認
3. 保存後に編集画面に遷移し、明細データが忠実に反映されていることを確認
4. 工事名と顧客名がヘッダーに正しく反映されていることを確認
