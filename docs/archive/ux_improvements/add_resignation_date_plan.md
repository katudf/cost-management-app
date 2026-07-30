# 実装計画: 作業員情報への「退社日」追加

作業員管理機能において、各作業員の設定項目に「退社日」を追加します。

## データベースの更新について
現在の `Workers` テーブルには `resignationDate`（または退社日用の列）が存在しません。
Supabase の SQL エディタで以下のコマンドを実行し、列を追加していただく必要があります。

```sql
ALTER TABLE public.Workers ADD COLUMN resignation_date date;
```

## Proposed Changes

### [Component: Worker Management]

#### [MODIFY] [WorkerEditModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/WorkerEditModal.jsx)
- 入社日の項目の隣、または下に「退社日」の入力フィールド（type="date"）を追加します。
- `editingWorker.resignation_date` として状態を管理します。

#### [MODIFY] [WorkerDetailsModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/WorkerDetailsModal.jsx)
- 詳細画面の「入社日」の隣に「退社日」の表示項目を追加します。
- 退社日が設定されている場合は表示し、設定されていない場合は「-」または非表示にします。

### [Document: Database]

#### [MODIFY] [database_info.md](file:///C:/Users/katuy/Desktop/cost-management-app/docs/database/database_info.md)
- `Workers` テーブルの定義に `resignation_date date` を追加し、ドキュメントを最新状態に更新します。

## Open Questions
- 退社日が入力されている作業員を、作業員一覧（WorkersTab）や配置表の選択肢から自動的に除外する（またはグレーアウトする）ロジックは必要でしょうか？今回は「項目の追加」のみに留めますが、必要であれば追加実装可能です。

## Verification Plan

### Automated Tests
- なし（UI変更がメインのため）

### Manual Verification
- 作業員編集モーダルを開き、「退社日」が入力できることを確認。
- 保存後、詳細画面で「退社日」が正しく表示されることを確認。
- データベース上の値が正しく更新されていることを確認。
