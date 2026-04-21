# 工事基本設定への「元請」項目追加および配置表の表示改善計画

工事基本設定に「元請」かどうかを指定するチェックボックスを追加し、配置表（ガントチャート）の現場名表示に顧客名または「元請」を表示するように機能を拡張します。

## ユーザーレビューが必要な事項

> [!IMPORTANT]
> **データベースの変更が必要です**
> `Projects` テーブルに新しく `is_prime_contractor` カラムを追加する必要があります。
> 以下のSQLを Supabase の SQL Editor で実行していただく必要があります。
> ```sql
> ALTER TABLE "Projects" ADD COLUMN "is_prime_contractor" BOOLEAN DEFAULT FALSE;
> ```

## 提案される変更内容

### 1. データベース連携の更新

#### [useSupabaseData.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useSupabaseData.js)
- `Projects` テーブルからのデータ取得 (`fetchAllData`) およびローカルステートへのマッピングに `is_prime_contractor` を追加します。

### 2. 工事基本設定画面の修正

#### [MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx)
- 「顧客名」設定の横に「元請」のチェックボックスを追加します。
- チェックボックスの変更が即座にデータベースに反映されるようにハンドラを設定します。

### 3. 配置表（ガントチャート）の修正

#### [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
- `AssignmentChartTab` に `customers` データをプロップとして渡すように変更します。

#### [AssignmentChartTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/AssignmentChartTab.jsx)
- `fetchAssignments` 内のプロジェクト取得クエリに `customerId` と `is_prime_contractor` を追加します。
- 現場名の表示ロジックを以下のように変更します：
  - `元請` にチェックがある場合： `現場名 (元請)`
  - `元請` にチェックがなく顧客名が設定されている場合： `現場名 (顧客名)`
  - いずれも設定されていない場合： `現場名`

---

## 確認計画

### 手動確認事項
1. **設定の反映**:
   - 工事基本設定（MasterTab）でプロジェクトを選択し、「元請」にチェックを入れて保存。
   - 再読み込みしてもチェック状態が維持されていることを確認。
2. **配置表での表示**:
   - 配置表タブに移動し、当該プロジェクトの現場名が `現場名 (元請)` となっていることを確認。
   - 「元請」のチェックを外し、顧客名を選択した状態で、配置表の表示が `現場名 (顧客名)` に変わることを確認。
