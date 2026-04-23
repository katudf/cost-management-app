# 修正内容の確認 (Walkthrough)

見積書のNET金額を、従来の自動計算だけでなく「％指定」や「手入力」に変更できる機能を実装しました。

## 実装された機能

### 1. NET計算方法の選択
編集画面の右サイドバー「金額集計」パネルに設定項目を追加しました。
- **自動**: 従来通り、明細合計の100%を表示。
- **％指定**: 指定したパーセンテージ（デフォルト95%）を明細合計に掛けた金額を表示。
- **手入力**: 任意の金額を直接入力して表示。

### 2. リアルタイム集計
サイドバーでの設定変更は即座に集計パネルの「NET（純工事費）」欄に反映されます。

### 3. 保存とPDF出力への反映
設定した計算方法と金額はデータベースに保存され、PDFを出力した際にも反映されます。

## 変更ファイル
- [supabaseEstimates.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/supabaseEstimates.js): 計算ロジック `calcTotals` の拡張
- [EstimateForm.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimateForm.jsx): 画面への設定UI追加、保存・読込処理の更新
- [EstimatePDF.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/EstimatePDF.jsx): PDF生成ロジックの更新

## ユーザー様による確認事項
> [!IMPORTANT]
> データベースの更新内容を反映するため、先に提供したSQLコマンドをSupabaseのSQL Editorで実行してください。

## 動作確認手順
1. 見積書の編集画面を開く。
2. 右側の集計パネルの下にある「NET計算設定」を確認する。
3. 「％指定」を選び、数値を変更してNET金額が変わることを確認する。
4. 保存ボタンを押し、PDFプレビューを開いてNET金額が一致していることを確認する。
