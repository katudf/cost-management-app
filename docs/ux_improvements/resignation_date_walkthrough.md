# 作業完了: 作業員情報への「退社日」追加

作業員管理画面において、各作業員の「退社日」を登録・表示できる機能を実装しました。

## 実施内容

### 1. データベースドキュメントの更新
- [database_info.md](file:///C:/Users/katuy/Desktop/cost-management-app/docs/database/database_info.md) に `resignation_date` カラムを追加しました。

### 2. 詳細画面での表示
- [WorkerDetailsModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/WorkerDetailsModal.jsx) を修正し、入社日の隣に退社日を表示するようにしました。
- 退社日が設定されている場合は赤字で強調表示されます。

### 3. 編集画面での入力
- [WorkerEditModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/WorkerEditModal.jsx) に退社日の日付選択フィールド（カレンダー）を追加しました。

### 4. 保存ロジックの追加
- [useWorkers.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useWorkers.js) の保存処理（`saveWorker`）を更新し、データベースへの値の保存・更新を有効にしました。

---

## ユーザーの方への重要なお願い

> [!IMPORTANT]
> **データベース（Supabase）の更新が必要です**
> 
> 画面を正常に動作させるため、Supabase の SQL エディタで以下のコマンドを実行し、テーブルの列を追加してください。
> 
> ```sql
> ALTER TABLE public.Workers ADD COLUMN resignation_date date;
> ```
