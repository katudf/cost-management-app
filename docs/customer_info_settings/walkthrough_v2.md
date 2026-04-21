# 顧客選択機能の追加 - 修正内容の確認

工事設定タブにおいて、プロジェクトごとに顧客を設定できる機能を実装しました。

## 実施した変更内容

### 1. データ取得ロジックの更新
- **[useSupabaseData.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useSupabaseData.js)**
    - `Customers` テーブルから全顧客データを取得する処理を追加しました。
    - プロジェクトのマッピング処理に `customerId` を追加し、フロントエンドで保持できるようにしました。

### 2. コンポーネント間のデータ連携
- **[AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)**
    - `useSupabaseData` から取得した顧客リストを `MasterTab` コンポーネントに伝播させました。

### 3. UIの更新
- **[MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx)**
    - 「工事基本設定」セクションに「顧客名」のドロップダウンメニューを追加しました。
    - 顧客を選択すると、即座にデータベースの `Projects` テーブルにある `customerId` カラムが更新されます。

## 確認事項

- [x] 工事設定タブの「工事基本設定」に「顧客名」プルダウンが表示されている。
- [x] 設定タブの「顧客情報」で登録した内容がプルダウンの選択肢に反映されている。
- [x] 顧客を選択して再読み込みしても、選択状態が保持されている。

> [!NOTE]
> 既存の `Projects` テーブルに `customerId` カラムが既に存在していたため、DBスキーマの変更なしに実装を完了しました。
