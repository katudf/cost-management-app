# RLS ポリシー修正計画（新規作成エラーの解消）

見積書の保存時に発生している「new row violates row-level security policy」エラーを解消します。

## ユーザーレビューが必要な事項

> [!IMPORTANT]
> **修正 SQL の実行が必要です**
> 本エラーは、以前に実行した SQL の RLS ポリシーが `TO authenticated`（ログイン済みユーザーのみ）に制限されていることが原因です。
> 現在のアプリはログインなしで動作しているため、`anon`（匿名ユーザー）にも権限を付与する SQL を Supabase の SQL Editor で再実行していただく必要があります。

## 原因分析
- エラーメッセージ：`new row violates row-level security policy for table "estimates"`
- 原因：現在の SQL 定義が `CREATE POLICY ... TO authenticated ...` となっており、未ログイン状態（`anon` ロール）での `INSERT` が拒否されています。

## 提案される修正 SQL

Supabase の SQL Editor で以下のコマンドを実行してください。

```sql
-- 既存の制限の厳しいポリシーを削除
DROP POLICY IF EXISTS "estimates_all"      ON public.estimates;
DROP POLICY IF EXISTS "estimate_items_all" ON public.estimate_items;

-- 未ログインユーザー(anon)およびログイン済みユーザー(authenticated)の両方に権限を付与
CREATE POLICY "estimates_all" ON public.estimates
  FOR ALL TO anon, authenticated USING (deleted_at IS NULL);

CREATE POLICY "estimate_items_all" ON public.estimate_items
  FOR ALL TO anon, authenticated USING (true);
```

## 修正対象ファイル

### [MODIFY] [database_info.md](file:///c:/Users/katuy/Desktop/cost-management-app/docs/database/database_info.md)
- RLS ポリシーの定義部分を、上記の `TO anon, authenticated` を含む最新の内容に更新します。

---

## 確認計画

### 手動確認事項
- [ ] ユーザー様に上記の SQL を実行していただく。
- [ ] 実行後、「見積書 新規作成」画面で保存ボタンを押し、エラーなく保存が完了することを確認する。
