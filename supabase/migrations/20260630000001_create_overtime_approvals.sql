-- Create OvertimeApprovals table
-- 残業の承認管理。日次×作業員×現場で1件。残業入力時に pending で自動起票し、職長が承認する。
CREATE TABLE IF NOT EXISTS "OvertimeApprovals" (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id      BIGINT NOT NULL REFERENCES "Projects"(id) ON DELETE CASCADE,
    worker_name     TEXT   NOT NULL,
    date            DATE   NOT NULL,
    status          TEXT   NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved'
    requested_hours NUMERIC NOT NULL DEFAULT 0,         -- 申請時点の残業合計
    approved_hours  NUMERIC,                            -- 承認時点の残業合計（差分検知用）
    reason          TEXT,                               -- 残業理由（任意）
    approved_by     TEXT,                               -- 承認した職長名
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (project_id, worker_name, date)
);

CREATE INDEX IF NOT EXISTS idx_overtime_approvals_lookup
    ON "OvertimeApprovals" (worker_name, date);
CREATE INDEX IF NOT EXISTS idx_overtime_approvals_project_status
    ON "OvertimeApprovals" (project_id, status);

-- RLS settings to allow open access for this application
-- （既存テーブル PurchaseRecords と同じ「全ユーザー許可」方針。anon キーでの直接アクセスを許可する）
ALTER TABLE public."OvertimeApprovals" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public."OvertimeApprovals"
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for all users" ON public."OvertimeApprovals"
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all users" ON public."OvertimeApprovals"
    FOR UPDATE USING (true);

CREATE POLICY "Enable delete for all users" ON public."OvertimeApprovals"
    FOR DELETE USING (true);
