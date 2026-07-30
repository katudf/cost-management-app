# 見積書作成機能 Phase 3/5 完成 - 修正内容の確認

仕様書 v3.0 に基づき、Phase 3（明細入力UI改善）と Phase 5（バリデーション最終調整）の全残作業を完了しました。

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| supabaseEstimates.js | 見積番号の重複チェック関数 `checkDuplicateNumber` を追加 |
| EstimateForm.jsx | 6項目の機能追加（下記詳細） |
| EstimateList.jsx | 税込合計表示のコメント更新 |

## 実装した機能

### 1. 編集ロック
- `submitted`/`accepted`/`rejected` のとき、全入力フィールドが `disabled`、保存ボタンも無効化。
- 「下書きに戻す」ボタンで `draft` に戻して再編集可能。

### 2. 見積番号の重複チェック
- 保存時にDB重複チェック（自身のIDは除外）。

### 3. バリデーション強化
- 工種の最低1件チェック、各工種配下の細別最低1件チェック。

### 4. 合計行の自動挿入
- `show_subtotals=ON` 時、保存時に各工種末尾に `subtotal` 行を自動生成。
- UI上ではリアルタイムで小計行を読み取り専用で表示。

### 5. 税込合計のDB保存
- 保存時に `total_with_tax` を計算しDBに保存。

### 6. 行数上限チェック
- 300行超過時にエラーメッセージ表示。

## 必要なDB変更

```sql
ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS total_with_tax numeric;
```
