# リファクタリング フェーズ2：UIコンポーネント（モーダル等）の分離

## Goal Description
現在 `AdminApp.jsx` 内に直接記述されている大規模なJSX（特に各種モーダルコンポーネント）を、独立したReactファイルとして `src/components/` ディレクトリに切り出します。
これにより、メインファイルの行数（約2000行）をさらに削減し、今後の拡張やデバッグを容易にします。機能自体の変更は含まれません。

## Proposed Changes

### Components
以下の新規コンポーネントを作成し、`AdminApp.jsx` からUIのJSX部分を移行します。必要なStateとコールバック関数はPropsとして渡す設計にします。

#### [NEW] [WorkerEditModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/WorkerEditModal.jsx)
作業員の追加・編集を行うモーダル。
- Props: `isOpen`, `editingWorker`, `setEditingWorker`, `onClose`, `onSave`

#### [NEW] [ExportReportModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/ExportReportModal.jsx)
就労日報のExcel出力を行うモーダル。
- Props: `isOpen`, `workerName`, `exportWeekStart`, `setExportWeekStart`, `onClose`, `onExport`, `isLoading`

#### [NEW] [ImportModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/ImportModal.jsx)
Excelデータのインポートオプションを選択するモーダル。
- Props: `info`, `isLoading`, `aliasName`, `setAliasName`, `onChoice`, `onCancel`

---
### Main Application

#### [MODIFY] [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
- 上記3つの新規コンポーネントをインポートする。
- 該当するモーダルのJSX部分（`{isWorkerModalOpen && editingWorker && ...}` 等）を削除し、インポートしたコンポーネントに置き換える。
- Propsに必要な状態や関数（`setImportModalInfo` 等）を正しく渡す。

## Verification Plan

### Manual Verification
1. アプリを起動し、エラーが出ないことを確認する。
2. 作業員一覧タブから「追加する」ボタン、または既存作業員の「編集」ボタンを押し、作業員編集モーダルが正しく開くこと、および保存・キャンセルができることを確認する。
3. 作業員一覧タブから各作業員の「出力」ボタンを押し、日報出力モーダルが正しく開くこと、日付が選択できること、Excel出力が実行できることを確認する。
4. 「工事設定」タブから「Excelからインポート」を実行し、インポート選択モーダルが正しく表示されること、および選択したインポート処理が正常に実行されることを確認する。
