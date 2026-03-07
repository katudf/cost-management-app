# リファクタリング フェーズ3：Excel出力・入力ロジックのユーティリティ化

## Goal Description
`AdminApp.jsx` の約400行〜500行を占めている、複雑なExcelのエクスポートおよびインポート（パース）処理のロジックを、純粋関数として `src/utils/` の別ファイルへ分離します。コンポーネントにおける「状態」と「計算・入出力」を明確に分け、メインファイルを1000行台前半までさらに削減します。

## Proposed Changes

### Component / Utilities
以下の新規ユーティリティファイルを作成し、`AdminApp.jsx` からロジックを移行します。

#### [NEW] [excelExportUtils.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/excelExportUtils.js)
Excel出力に関連する関数をまとめたファイル。
- `exportToExcel(activeProject, summaryData)`
  - 現場サマリーの出力を担当。
- `exportWorkerReport(exportModalWorker, exportWeekStart, recordsData, subcontractorRecordsData, projects)`
  - （※ DB取得などの非同期処理は `AdminApp.jsx` 側に残し、取得したデータを引数として渡す純粋なExcel生成ロジックにするか、Supabaseクライアントをインポートして中で取得処理までさせるか設計します。今回はSupabaseアクセスも含め関数化することでAdminAppをクリーンに保ちます）
  - `exportWorkerReport(exportModalWorker, exportWeekStart, projects, workers)`

#### [NEW] [excelImportUtils.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/excelImportUtils.js)
Excel読み込みに関する関数をまとめたファイル。
- `parseExcelForImport(file, HOURLY_WAGE)`
  - FileReaderを用いてExcelファイルを読み込み、JSON配列に変換し、プロジェクト名や作業項目データ（MasterData形式）を取り出して返す非同期関数。

---
### Main Application

#### [MODIFY] [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
- `exportToExcel`, `exportWorkerReport`, `handleExcelImport` の内部ロジックを上記ユーティリティの呼び出しに置き換える。
- (DBアクセス部分の一部は、フック内で処理するか、ユーティリティ側にsupabase参照を渡すなどで調整)

## Verification Plan

### Manual Verification
1. **Excelインポート**: 「工事設定」タブで「Excelからインポート」を実行し、正しくパースされてインポートモーダルが表示されること、および登録ができること。
2. **サマリー出力**: 「ダッシュボード」タブで「Excel出力」を実行し、これまでのフォーマットと同様の現場サマリーExcelが出力されること。
3. **就労日報出力**: 「作業員情報」の一覧から特定の作業員の「出力」を実行し、これまでのフォーマットと同様の就労日報Excelが出力されること。
