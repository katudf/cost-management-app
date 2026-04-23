# 見積書NET金額の計算・入力方法の変更計画

現在、NET金額（純工事費）は固定費を除いた明細合計が自動的に表示されていますが、これを「指定した％での計算」または「自由記入（手入力）」に切り替えられるように変更します。

## ユーザーレビューが必要な点

> [!IMPORTANT]
> この機能を永続化（保存）するために、データベース（Supabase）の `estimates` テーブルに新しいカラムを追加する必要があります。
> 以下のSQLコマンドをSupabaseのSQL Editorで実行してください。

```sql
ALTER TABLE estimates 
ADD COLUMN net_calc_type TEXT DEFAULT 'auto',
ADD COLUMN net_perc NUMERIC DEFAULT 95,
ADD COLUMN net_amount NUMERIC;

COMMENT ON COLUMN estimates.net_calc_type IS 'NET金額の計算タイプ (auto, perc, manual)';
COMMENT ON COLUMN estimates.net_perc IS 'NET金額の計算倍率 (%)';
COMMENT ON COLUMN estimates.net_amount IS 'NET金額の手入力値';
```

## 提案する変更内容

### [MODIFY] [supabaseEstimates.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/supabaseEstimates.js)

#### `calcTotals` 関数の更新
- 引数に `netSettings`（計算タイプ、％、手入力金額）を追加します。
- 計算タイプに応じて `net` 金額を算出するように変更します。
  - `auto`: 明細合計の100%
  - `perc`: 明細合計 × 指定％
  - `manual`: 入力された金額をそのまま使用

### [MODIFY] [EstimateForm.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimateForm.jsx)

#### UIの更新（右サイドバー）
- 「金額集計」セクションに、NET金額の計算設定を追加します。
- ラジオボタンまたはセレクトボックスで計算方法を選択：
  - **自動 (100%)**
  - **％指定** （入力欄を表示、デフォルト95％）
  - **手元入力** （金額入力欄を表示）
- 選択内容に応じてリアルタイムで集計パネルの「NET（純工事費）」が更新されるようにします。

#### 保存・読込処理の更新
- ヘッダー情報として `net_calc_type`, `net_perc`, `net_amount` をDBから読み込み、保存するようにします。

### [MODIFY] [EstimatePDF.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimatePDF.jsx)

#### PDF出力への反映
- PDF生成時に、保存されたNET設定を `calcTotals` に渡すように修正し、指定通りの金額が表示されるようにします。

## 検証計画
- [ ] 見積編集画面で「％指定」を選択し、95%の金額正しく表示されるか確認する。
- [ ] 「手元入力」を選択し、任意の数値を入力して合計パネルに反映されるか確認する。
- [ ] 保存して再度開いた際に、選択した計算方法と金額が維持されているか確認する。
- [ ] PDFに出力した際、設定した通りのNET金額が出力されているか確認する。
