# 見積金額表示機能 実装タスクリスト

## 1. データベースの改修
- [x] `ProjectTasks` テーブルに `estimated_amount` カラム（数値型）を追加する

## 2. AdminApp.jsx：データ読込・保存処理の修正
- [x] Excelインポート (`handleExcelImport`) 時に、元の金額(`amount`)を `estimated_amount` としてDBに保存するように修正
- [x] 新規項目手動追加時 (`addMasterItem`) に、初期値として `estimated_amount: 0` を含めてDBに保存する
- [x] 既存データ読み込み時 (`fetchAllData`) に、`ProjectTasks` から `estimated_amount` を取得して `masterData` ステートに含める
- [x] 項目の更新時 (`updateMasterItemField`) に、`estimated_amount` が変更された場合はDBも更新するように処理を追加

## 3. AdminApp.jsx：UIの修正
- [x] 「工事設定」タブ (`activeTab === 'master'`) に、「見積金額」を入力・編集できる列（input要素）を追加する
- [x] 「管理シート」タブ (`activeTab === 'summary'`) の「項目別詳細予測」テーブルに、「見積金額」を表示する列を追加する
- [x] （オプション）全体サマリー部分に「現場全体の見積金額（合計）」も表示する
- [x] エクセル出力機能 (`exportToExcel`) に、「見積金額」列を出力するよう追加する

## 4. テスト・検証
- [x] 工事設定タブで手動で見積金額を入力・保存・表示ができるか確認する
- [x] Excelをインポートして、見積金額が正しく自動反映されるか確認する
- [x] 管理シートの表示と、ダウンロードしたExcelファイルに見積金額が含まれているか確認する
