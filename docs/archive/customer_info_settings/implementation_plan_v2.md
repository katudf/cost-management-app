# 工事設定タブでの顧客選択機能の追加実装計画

工事設定タブ（工事基本設定）において、プロジェクトに紐づく顧客を選択・設定できる機能を追加します。

## ユーザーレビューが必要な事項

> [!IMPORTANT]
> データベースの `Projects` テーブルには既に `customerId` カラムが存在することを確認しました。このカラムを使用して顧客情報を紐付けます。

## 提案される変更点

### データ取得と管理 [Hooks]

#### [MODIFY] [useSupabaseData.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useSupabaseData.js)
- `Customers` テーブルから全顧客データを取得する処理を追加します。
- プロジェクトのデータマッピング処理に `customerId` を追加します。
- フックの戻り値に `customers` を追加します。

### 管理画面メイン [Component]

#### [MODIFY] [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
- `useSupabaseData` から `customers` を取得します。
- `MasterTab` に `customers` プロパティを渡します。

#### [MODIFY] [MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx)
- `customers` プロパティを受け取ります。
- 「工事基本設定」セクションに「顧客名」を選択するためのプルダウンメニュー（`<select>`）を追加します。
- 選択内容の変更時にデータベースへ保存するように紐付けます。

## 修正内容の確認方法

### 手動確認
- 「工事設定」タブ内の「工事基本設定」画面に「顧客名」の選択項目が表示されていることを確認します。
- 「設定 -> 顧客情報」で登録した顧客がプルダウンの選択肢に表示されることを確認します。
- 顧客を選択・保存し、画面をリロードしても選択内容が保持されていることを確認します。
