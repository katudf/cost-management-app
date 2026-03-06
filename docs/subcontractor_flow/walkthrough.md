# 常用下請け業者の処理フロー実装 完了後の確認 (Walkthrough)

## 実装した機能の概要
下請け（協力）業者の日々の労務データを管理・集計する機能を実装しました。
1人工あたり25,000円でプロジェクトの全体コストに算入されます。

## 1. データベースの準備 (ユーザー作業)
Supabaseダッシュボード（SQL Editor等）にて、以下のSQLを実行して新しいテーブルを作成してください。
（このSQLは `docs/subcontractor_flow/schema.sql` にも保存しています）

```sql
-- 協力業者入力用テーブル作成SQL
CREATE TABLE public."SubcontractorRecords" (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    project_id integer NOT NULL,
    date date NOT NULL,
    company_name text NOT NULL,
    worker_count numeric NOT NULL,
    unit_price numeric NOT NULL DEFAULT 25000,
    worker_name text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "SubcontractorRecords_pkey" PRIMARY KEY (id),
    CONSTRAINT "SubcontractorRecords_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public."Projects"(id) ON DELETE CASCADE
);

-- RLS (Row Level Security) の設定
ALTER TABLE public."SubcontractorRecords" ENABLE ROW LEVEL SECURITY;

-- 全ての操作を許可するポリシー
CREATE POLICY "Enable all access" ON public."SubcontractorRecords"
    AS PERMISSIVE FOR ALL
    TO public
    USING (true)
    WITH CHECK (true);
```

## 2. WorkerApp (職長アプリ) の変更点
- 日報入力画面の一番下に、**「協力業者 (常用)」** の入力セクションを追加しました。
- このセクションは、対象のプロジェクトで「職長」として設定されているユーザーがログインした時のみ表示されます。
- 「+ 追加」ボタンから入力行を増やし、**「会社名」**と**「人数(人)」**を入力・編集・削除できます。
- 日報の「今日の実績を送信」ボタンを押すことで、タスク実績と一緒にSupabaseの `SubcontractorRecords` テーブルに保存・更新されます。

## 3. AdminApp (管理アプリ) の変更点
- プロジェクト（現場）ごとの協力業者の記録データを取得し、**コスト (人数 × 25,000円)** を自動で集計するようにしました。
- 各現場の「全体進捗 / 予測粗利」の計算において、協力業者の発生コストが **赤字要因として（マイナスされて）反映** されるようにロジックを修正しました。
- 管理シート（詳細画面）の上部サマリーに、**「協力業者 発生コスト (累計)」** のカードを新設し、いくらかかっているかが一目でわかるようにしました。
- **「実績入力」タブ**に、自社作業員の日報と同様に **協力業者実績を入力・編集・削除できるテーブル** を追加しました。これにより、アプリを使わない職長の代理入力や修正が可能になります。

## 動作確認の手順
1. **DBの準備**: SupabaseのSQLエディタで上記のSQLを実行し、テーブルを作成してください。
2. **WorkerAppでの入力**:
   - `http://localhost:5173/worker` などを開き、職長として設定されているユーザーでログインします。
   - 今日の現場を選択し、下部の「協力業者」欄でテスト用の会社名と人数（例：菊池塗装工業、2人）を入力して送信します。
3. **AdminAppでの確認**:
   - `http://localhost:5173/` を開きます。
   - 対象の現場の予測損益（現場全体の予測粗利）が、入力した人数分（例：2人×25,000円=50,000円）マイナスに変動していること、およびオレンジ色の「協力業者 発生コスト (累計)」欄にその金額が表示されていることを確認します。
