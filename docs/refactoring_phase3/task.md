# リファクタリング フェーズ3：Excel出力・入力ロジックのユーティリティ化

## 目標
`AdminApp.jsx` 内にある約400〜500行に及ぶ、複雑なExcelのエクスポートおよびインポート（パース）処理のロジックを、純粋関数として `src/utils/` の別ファイルへ分離します。これによりコンポーネントにおける「状態」と「計算・入出力」を明確に分け、メインファイルの行数を1000行台前半までさらに削減します。

## 対象となる主な関数
1. `exportToExcel`（現場サマリー出力）
2. `exportWorkerReport`（日報出力）
3. `handleExcelImport` の内部ロジック（Excelデータのパースと生成）

## タスク一覧
- [x] `src/utils/excelExportUtils.js` の作成
  - `exportToExcel` のロジック移動
  - `exportWorkerReport` のロジック移動
- [x] `src/utils/excelImportUtils.js` の作成
  - `parseImportedExcel` （Excelパース処理部分）の関数化と移動
- [x] `AdminApp.jsx` を更新して新しいユーティリティ関数をインポート・利用する
- [x] 動作確認（Excelエクスポートとインポートが正常に動作すること）
