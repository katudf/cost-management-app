# データベース定義書の更新 - 修正内容の確認

データベースの最新のテーブル定義およびカラム追加を反映し、`docs/database/database_info.md` を全面的に改訂しました。

## 実施した変更内容

### 1. 統合定義書の全面刷新
- **[database_info.md](file:///c:/Users/katuy/Desktop/cost-management-app/docs/database/database_info.md)**
    - 表形式から、直接確認しやすい **SQL (DDL) 形式のドキュメント**に書き換えました。
    - 各テーブルのカラム名、データ型、および役割（コメント）を明記しました。

### 2. 最新カラム・テーブルの追記
以下の最新機能に伴うスキーマ変更をドキュメントに反映しました。

- **`Projects`**: `is_prime_contractor` (元請フラグ)、`foreman_worker_id` (担当職長) の追加。
- **`ProjectSuspensions` (新規)**: 休工期間管理用テーブルの定義。
- **`SubcontractorRecords` (新規)**: 協力業者の作業人数や単価の記録用。
- **`PurchaseRecords` (新規)**: 仕入れ・外注費用の管理用。
- **`system_settings` (新規)**: 基本時給などのシステム定数管理用。
- **`TaskRecords`**: 残業時間を記録する `overtime_hours` を追加。

## 検証結果

- [x] 現在の `useSupabaseData.js` でフェッチされているカラム名と一致していることを確認。
- [x] 配置図や工事設定タブのコード上で扱われているプロパティ名と整合性が取れていることを確認。
- [x] 過去のマイグレーションSQLファイルの内容が網羅されていることを確認。

---

> [!NOTE]
> このドキュメントはシステムの「設計図」として機能します。今後、データベースのスキーマを変更した際は、併せてこのドキュメントを更新することを推奨します。
