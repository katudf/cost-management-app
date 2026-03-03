# DB移行フェーズ1: Supabaseデータベースの設定手順

現在のアプリ運用（localStorage）からデータベース運用への移行に向け、既存のデータベース構造に必要な追加設定を行います。
Supabaseのダッシュボード（SQL Editorなど）から、以下の内容を実行してください。

## 1. `ProjectTasks`（作業項目）テーブルへのカラム追加
現在のアプリで設定している「目標時間（`target`）」と、進捗バーで操作する「進捗率（％）」を保存するためのカラムを既存の `ProjectTasks` テーブルに追加します。

```sql
-- ProjectTasksテーブルに目標時間と進捗率のカラムを追加
ALTER TABLE public."ProjectTasks" 
ADD COLUMN target_hours bigint DEFAULT 0,
ADD COLUMN progress_percentage bigint DEFAULT 0;
```

## 2. 実績入力用テーブル（`TaskRecords`）の新規作成
職長が入力するシンプルで直感的な日報（実績）データに対応するため、既存の複雑な `WorkLogs` ではなく、新しい実績記録用テーブルを1つ作成し、プロジェクト（現場）と作業項目に紐付けます。

```sql
-- 実績記録用テーブルの作成
CREATE TABLE public."TaskRecords" (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    date date NOT NULL,
    project_id bigint NOT NULL,
    project_task_id bigint NOT NULL,
    worker_name text,
    hours double precision NOT NULL DEFAULT 0,
    note text,
    CONSTRAINT "TaskRecords_pkey" PRIMARY KEY (id),
    CONSTRAINT "TaskRecords_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public."Projects"(id) ON DELETE CASCADE,
    CONSTRAINT "TaskRecords_project_task_id_fkey" FOREIGN KEY (project_task_id) REFERENCES public."ProjectTasks"(id) ON DELETE CASCADE
);

-- アクセス権限（RLS）が設定されている場合は、アクセス許可等のポリシーの追加が必要になる場合があります。
-- とりあえず基本機能の連携を試すだけなら、RLSを無効にするか、全ユーザーに許可を出す設定をSupabaseの画面から行ってください。
```

## 次のステップ（アプリ側の改修）
上記のSQLをSupabase上で実行（またはそれに相当する操作を画面上で行う）していただき、対応が完了しましたらお知らせください。
完了後、システムのコード（`App.jsx`など）を、これらのテーブルを読み書きするように改修（フェーズ2,3）に入ります。
