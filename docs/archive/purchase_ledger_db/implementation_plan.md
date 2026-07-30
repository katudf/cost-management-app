# 実装計画: 仕入帳データのデータベース(Supabase)移行

## 目的
現在ローカルのExcelファイルから読み込んでいる仕入帳データを、Supabase上のデータベースサーバー (`PurchaseRecords` テーブル) に移行し、システムが安全かつ動的にデータを参照・管理・編集できるようにする。

## 提案する変更内容

### 1. データベーススキーマの定義
#### [NEW] `supabase/migrations/[timestamp]_create_purchase_records.sql`
- 以下を備えた `PurchaseRecords` テーブルを作成します。
  - `id`: 一意の識別子
  - `date`: 日付（Excelのシリアル値を `YYYY-MM-DD` な日付形式に変換）
  - `project_name`: 工事名
  - `supplier`: 購入先
  - `item_name`: 名称
  - `note`: 備考
  - `quantity`: 数量
  - `unit`: 単位
  - `unit_price`: 単価
  - `amount`: 金額
  - `created_at`: レコード作成日時

### 2. 初期データのアップロードスクリプト作成
#### [NEW] `scripts/upload_purchase_ledger.js`
- 既存の `docs/test_data/仕入帳.xlsx` を読み込み、Supabase の `PurchaseRecords` テーブルへ一括インサート (Bulk Insert) するNode.jsスクリプトを作成・実行します。

### 3. フロントエンドの連携変更
#### [MODIFY] `src/components/tabs/PurchaseLedgerTab.jsx`
- Excelファイルをフロントエンドで直接読み込む処理 (`xlsx` 依存およびアセットインポート) を削除します。
- 代わりに `supabase.from('PurchaseRecords').select('*')` を呼び出し、リアルタイムまたはデータベースからの最新データを取得して表示するように変更します。

## ユーザー様への確認事項
- 移行後、ブラウザでファイルを読み込む機能は不要になりますがよろしいでしょうか。
- 以降の運用において、仕入帳データをシステム上で追加・編集する機能等も必要になってくる見込みがあります。今回はまず「Excelデータの移行と、DBからの表示」に注力する計画でよろしいでしょうか？
