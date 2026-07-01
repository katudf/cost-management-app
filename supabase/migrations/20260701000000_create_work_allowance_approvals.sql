-- Create WorkAllowanceApprovals table
-- 作業手当の承認管理。日次×作業員×現場で1件。work_allowanceチェック済みの作業がある場合に pending で自動起票し、職長が承認する。
CREATE TABLE IF NOT EXISTS "WorkAllowanceApprovals" (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id      BIGINT NOT NULL REFERENCES "Projects"(id) ON DELETE CASCADE,
    worker_name     TEXT   NOT NULL,
    date            DATE   NOT NULL,
    status          TEXT   NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved'
    task_names      TEXT[] NOT NULL DEFAULT '{}',       -- 申請時点で作業手当対象にチェックされた工種名
    approved_task_names TEXT[],                          -- 承認時点の工種名（差分検知用）
    approved_by     TEXT,                               -- 承認した職長名
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (project_id, worker_name, date)
);

CREATE INDEX IF NOT EXISTS idx_work_allowance_approvals_lookup
    ON "WorkAllowanceApprovals" (worker_name, date);
CREATE INDEX IF NOT EXISTS idx_work_allowance_approvals_project_status
    ON "WorkAllowanceApprovals" (project_id, status);

-- RLS settings to allow open access for this application
-- （既存テーブル OvertimeApprovals と同じ「全ユーザー許可」方針。anon キーでの直接アクセスを許可する）
ALTER TABLE public."WorkAllowanceApprovals" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public."WorkAllowanceApprovals"
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for all users" ON public."WorkAllowanceApprovals"
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all users" ON public."WorkAllowanceApprovals"
    FOR UPDATE USING (true);

CREATE POLICY "Enable delete for all users" ON public."WorkAllowanceApprovals"
    FOR DELETE USING (true);
