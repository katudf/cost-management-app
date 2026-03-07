-- システム共通設定テーブルの作成
CREATE TABLE IF NOT EXISTS system_settings (
    id integer PRIMARY KEY DEFAULT 1,
    hourly_wage integer NOT NULL DEFAULT 3500,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- id=1のレコード以外は作成されないようにするための制約（オプショナルですが推奨）
ALTER TABLE system_settings ADD CONSTRAINT ensure_single_row CHECK (id = 1);

-- 初期データの投入（手動で更新可能にするため、衝突時は無視します）
INSERT INTO system_settings (id, hourly_wage) 
VALUES (1, 3500) 
ON CONFLICT (id) DO NOTHING;

-- RLS (Row Level Security) の設定
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- 全員が読み取り可能なポリシー
CREATE POLICY "Enable read access for all users" ON system_settings
    FOR SELECT USING (true);

-- 全員が更新可能なポリシー（管理者のみなどに制限する場合は適宜変更してください）
CREATE POLICY "Enable update for all users" ON system_settings
    FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable insert for all users" ON system_settings
    FOR INSERT WITH CHECK (true);
