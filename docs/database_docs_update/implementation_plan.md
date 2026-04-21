# データベース定義書（database_info.md）の最新化計画

現在のシステムに実装されている最新のテーブル定義やカラム追加を反映し、`docs/database/database_info.md` を統合的なデータベースドキュメントとして更新します。

## ユーザーレビューが必要な事項

> [!IMPORTANT]
> **ドキュメントの更新のみです**
> 本タスクは既存の `docs/database/database_info.md` を、実際のソースコードやマイグレーション履歴に基づいた最新の状態に書き換えるものです。実際のデータベース（Supabase）への変更は伴いません。

## 提案される変更内容

以下の情報を網羅した定義書に更新します。

### 1. 既存テーブルの更新
- **Projects**: `is_prime_contractor`（元請フラグ）, `foreman_worker_id`（職長ID）を追加。
- **Customers**: 関連情報の整理。
- **TaskRecords**: `overtime_hours`（残業時間）のカラムを明記。

### 2. 新規テーブルの追加
- **ProjectSuspensions**: 現場の休工期間を管理するための定義を追加。
- **SubcontractorRecords**: 日報における協力業者の実績記録。
- **PurchaseRecords**: 仕入台帳（材料・外注費）の記録。
- **system_settings**: システム全体の設定（基本時給等）。

### 3. ドキュメント構成の改善
- 従来の表形式だけでなく、SQLブロックを用いることで、必要に応じてそのまま適用・確認しやすい形式にします。
- 各テーブルの用途や、リレーション（外部キー）に関する補足説明を追加します。

## 修正対象ファイル

### [MODIFY] [database_info.md](file:///c:/Users/katuy/Desktop/cost-management-app/docs/database/database_info.md)
- 全内容を最新のスキーマ定義に基づき書き換える。

---

## 確認計画

### 手動確認事項
- [ ] 各テーブル定義が、現在の `useSupabaseData.js` や `AssignmentChartTab.jsx` 等のコード上の利用実態と一致していること。
- [ ] 過去のマイグレーションファイル（`20260327143000_create_purchase_records.sql` 等）の内容が含まれていること。
- [ ] リンク切れや誤字脱字がないこと。
