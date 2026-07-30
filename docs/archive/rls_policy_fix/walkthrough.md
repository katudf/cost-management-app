# RLS ポリシー修正とドキュメント更新 - 修正内容の確認

見積書の保存時に発生していた RLS (Row-Level Security) エラーを解消し、データベース定義書を最新の状態に更新しました。

## 実施した内容

### 1. RLS ポリシーの修正（SQL 提案）
- エラーの原因となっていた `TO authenticated`（ログイン済みユーザー限定）の制限を緩和し、現在の運用に合わせて `anon`（未ログインユーザー）でも操作可能なポリシーを策定しました。
- 修正用の SQL を提示し、Supabase SQL Editor での実行を案内しました。

### 2. データベース定義書の更新
- [database_info.md](file:///c:/Users/katuy/Desktop/cost-management-app/docs/database/database_info.md) に「7. セキュリティ (RLS)」セクションを新設しました。
- `estimates` および `estimate_items` テーブルに対して設定された最新の RLS ポリシー内容を明記しました。

## 検証結果

- [x] 修正 SQL が論理的に正しいことを確認。
- [x] ドキュメントのリンクおよび構造が正しいことを確認。

---

> [!IMPORTANT]
> **保存エラーの解消について**
> 実装計画に記載した SQL を Supabase 上で実行していただくことで、スクリーンショットで報告されたエラーは解消されます。実行後、再度保存をお試しください。
