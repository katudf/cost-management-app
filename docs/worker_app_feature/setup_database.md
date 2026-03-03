# DB拡張: 作業員アプリ向け設定

作業員からの進捗入力を「その現場の職長」だけに限定するため、`Projects`（工事一覧）テーブルに新しいカラムを追加します。
Supabaseのダッシュボード（SQL Editorなど）から、以下のSQLコマンドを実行してください。

```sql
-- Projectsテーブルに、担当職長のIDを保存するカラム（foreman_worker_id）を追加
ALTER TABLE public."Projects" 
ADD COLUMN foreman_worker_id bigint REFERENCES public."Workers"(id) ON DELETE SET NULL;
```

※ 既存のデータを壊すことはありません。新たに1つカラムが増えるだけです。
上記を実行後、「進めて」とお知らせください！アプリ側の画面分割（ルーティング）の実装に入ります。
