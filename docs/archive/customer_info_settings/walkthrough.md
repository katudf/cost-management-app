# 顧客情報設定画面の追加 - 修正内容の確認

設定タブ内に「顧客情報」を管理するための機能を実装しました。

## 実施した変更内容

### 1. 新規コンポーネントの作成
- **[CustomerSettings.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/CustomerSettings.jsx)**
    - 顧客情報の表示、追加、編集、削除（CRUD）機能を実装しました。
    - 顧客名、住所、担当者名、電話番号の各フィールドに対応しています。
    - 顧客名や住所による検索フィルター機能を搭載しました。

### 2. 設定タブへの統合
- **[SystemSettingsTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/SystemSettingsTab.jsx)**
    - サブタブナビゲーションに「顧客情報」を追加しました。
    - `activeSubTab` ステートに `customers` を追加し、表示の切り替えを可能にしました。

## 確認事項

- [x] 「設定」タブ内に「顧客情報」ボタンが表示されている。
- [x] 顧客情報を新規登録できる。
- [x] 登録済みの顧客情報を編集できる。
- [x] 顧客情報を削除できる。
- [x] 検索バーで顧客を絞り込める。

> [!NOTE]
> データベースは `Customers` テーブルを直接参照しています。既存のデータがある場合は一覧に表示されます。
