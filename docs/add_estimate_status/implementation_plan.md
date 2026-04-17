# 現場ステータス「見積」の追加と表示フィルタリングの改善計画

現場管理の初期段階として「見積」ステータスを追加し、新規作成時のデフォルトに設定します。また、配置表には実働に近い「予定」および「施工中」の現場のみを表示するように制限します。

## 変更内容

### 1. [useProjects.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useProjects.js) [MODIFY]

- `addNewProject` 関数内で、新規プロジェクト作成時の `status` を `'予定'` から `'見積'` に変更します。

### 2. [MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx) [MODIFY]

- 現場ステータスのセレクトボックスに `'見積'` オプションを追加します。

### 3. [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx) [MODIFY]

- ダッシュボードのステータスフィルターに `'見積'` を追加します。
- プロジェクトカードのステータスバッジのスタイルに `'見積'` 用の配色を追加します。
- Excelインポート時の新規プロジェクト作成（`handleImportChoice`）でもデフォルトステータスを `'見積'` に設定します。

### 4. [AssignmentChartTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/AssignmentChartTab.jsx) [MODIFY]

- 配置表に表示する案件のフィルタリング条件を「`'完了'` 以外」から「`'予定'` または `'施工中'`」のみに変更します。

## 検証計画

### 手動確認
- 「新しい現場を追加」ボタンを押した際、デフォルトでステータスが「見積」になっていることを確認。
- ステータスを「見積」にした現場が、配置表（Assignment Chart）に表示されないことを確認。
- ステータスを「予定」または「施工中」に変更すると、配置表に表示されることを確認。
- ステータスを「完了」にすると、配置表から消えることを確認。
- ダッシュボードのフィルターで「見積」を絞り込み表示できることを確認。
