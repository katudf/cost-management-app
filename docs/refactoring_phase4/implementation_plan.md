# リファクタリング フェーズ4：メインタブUIのコンポーネント分割

## Goal Description
現在 `AdminApp.jsx` には4つの主要なタブ切り替えによる巨大なJSXブロックが含まれており、コードの可読性を下げています。
各タブのUI要素を `src/components/tabs/` 配下の別コンポーネントとして抽出し、`AdminApp.jsx` をさらにスッキリと保ちます。必要な状態（Props）や関数は親（`AdminApp`）から子へ渡す設計とします。

## Proposed Changes

### [NEW] src/components/tabs/DashboardTab.jsx
- 「ダッシュボード（サマリー）」タブのUI部分を抽出。
- **主なProps**: `activeProject`, `summaryData`, `updateLayer`, `saveProgressDB`, `handleExportToExcel`, `isLoading`

### [NEW] src/components/tabs/InputTab.jsx
- 「実績入力」タブ（日報・協力業者両方）のUI部分を抽出。
- **主なProps**: `activeProject`, `isLoading`, `addRecord`, `updateRecordField`, `removeRecord`, `workers`, `focusedWorkerRow`, `setFocusedWorkerRow`, `addSubcontractorRecord`, `updateSubcontractorRecordField`, `removeSubcontractorRecord`

### [NEW] src/components/tabs/MasterTab.jsx
- 「工事設定（マスター・仕様）」タブのUI部分を抽出。
- **主なProps**: `activeProject`, `isLoading`, `handleExcelImport`, `fileInputRef`, `removeProject`, `updateLayer`, `handleSiteNameBlur`, `handleProjectStatusChange`, `handleForemanChange`, `workers`, `updateMasterItemLocal`, `saveMasterItemDB`, `removeMasterItem`, `addMasterItem`, `HOURLY_WAGE`

### [NEW] src/components/tabs/WorkersTab.jsx
- 「作業員」タブのUI部分を抽出。
- **主なProps**: `isLoading`, `workers`, `addWorker`, `moveWorkerOrder`, `openEditWorkerModal`, `removeWorker`, `workerSummaryData`, `setExportModalWorker`

### [MODIFY] src/AdminApp.jsx
- 上記4つのタブコンポーネントをインポートし、`activeTab` の条件分岐部分を置き換えます。
- 巨大なJSXブロックが消え、大幅な行数ダウンが見込めます。

## Verification Plan
1. `npm run build` によるビルドエラーがないか確認。
2. 実際にアプリを起動し、4つのタブ切り替えが正常に行われること、またそれぞれのタブ内の基本操作（入力、設定等）でエラーが発生しないことを確認。
