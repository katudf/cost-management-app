# Excelインポート時の顧客名自動取得と登録の実装計画

Excelファイルをインポートする際、特定のセル（D13）から顧客名を取得し、データベースに自動登録・紐付けを行う機能を実装します。

## ユーザーレビューが必要な事項

> [!IMPORTANT]
> - 顧客名の取得は、Excelファイルの**最初のシートの D13 セル**を対象とします。
> - 同名の顧客が既に `Customers` テーブルに存在する場合は、その既存顧客を再利用します。存在しない場合のみ新規登録します。
> - プロジェクト作成（新規・上書き）時に、取得した顧客IDを `customerId` カラムにセットします。

## 提案される変更点

### 1. Excelパース処理の拡張 [Utils]

#### [MODIFY] [excelImportUtils.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/utils/excelImportUtils.js)
- `parseExcelForImport` 関数を修正し、最初のシートの `D13` セルの値を取得するようにします。
- 戻り値のオブジェクトに `customerName` を追加します。

### 2. インポート処理フローの修正 [AdminApp]

#### [MODIFY] [AdminApp.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/AdminApp.jsx)
- `handleExcelImport` 内でパース結果から `customerName` を受け取り、`importModalInfo` ステートに保持します。
- `handleImportChoice`（実際にDBへ保存する関数）を修正します：
  - 保存処理の冒頭で `customerName` が存在するか確認します。
  - 存在する場合、`Customers` テーブルから同名のレコードを検索します。
  - 見つからない場合は、新規に `Customers` テーブルへ挿入します。
  - 最終的に取得した `customerId` を、プロジェクトの作成/更新時（`supabase.from('Projects').insert/update`）のパラメータに追加します。

## 修正内容の確認方法

### 手動確認
1. 顧客名（例：「株式会社テスト」）が D13 セルに記載された Excel ファイルを用意します。
2. アプリケーションで「Excelからインポート」を実行します。
3. インポート完了後、工事設定画面で該当プロジェクトの「顧客名」が正しく設定されていることを確認します。
4. 設定タブの「顧客情報」一覧に、新しい顧客（株式会社テスト）が自動登録されていることを確認します。
5. 同じ顧客名の別のファイルを再度インポートした際、顧客情報が重複登録されず、既存の顧客が正しく紐付けられることを確認します。
