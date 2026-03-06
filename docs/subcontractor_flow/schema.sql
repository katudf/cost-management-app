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

-- 全ての操作を許可するポリシー (アクセス制御が必要な場合は調整してください)
CREATE POLICY "Enable all access" ON public."SubcontractorRecords"
    AS PERMISSIVE FOR ALL
    TO public
    USING (true)
    WITH CHECK (true);
