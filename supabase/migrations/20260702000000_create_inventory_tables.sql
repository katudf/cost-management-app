-- 在庫管理機能: Warehouses / InventoryItems テーブル + inventory-images ストレージバケット
-- AppSheet製在庫管理アプリからの移行。詳細は docs 参照。

-- === 倉庫マスタ ===
CREATE TABLE IF NOT EXISTS "Warehouses" (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    map_image_url TEXT,                        -- 位置図画像（inventory-images バケット内のURL）
    display_order INTEGER,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- === 在庫品目 ===
CREATE TABLE IF NOT EXISTS "InventoryItems" (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           TEXT NOT NULL,              -- 品名
    detail         TEXT,                       -- 詳細（色番・型番など）
    warehouse_id   BIGINT REFERENCES "Warehouses"(id) ON DELETE SET NULL,
    shelf_code     TEXT,                       -- 保管場所（棚番: A1, C7 など）
    slot_number    INTEGER,                    -- 位置（棚内の番号 0-9）
    quantity       NUMERIC NOT NULL DEFAULT 0, -- 個数
    category       TEXT,                       -- 種類（塗料/工具/... constants.js の INVENTORY_CATEGORY）
    recorded_date  DATE,                       -- 日付（最終更新日として利用）
    worker_id      BIGINT REFERENCES "Workers"(id) ON DELETE SET NULL, -- 登録者（Workersと紐付く場合）
    recorded_by    TEXT,                       -- 登録者名（Workers不一致時の文字列保持・表示用）
    image_url_1    TEXT,
    image_url_2    TEXT,
    image_url_3    TEXT,
    appsheet_id    TEXT,                       -- 旧AppSheetの行ID（移行トレース用）
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_warehouse
    ON "InventoryItems" (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category
    ON "InventoryItems" (category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_name
    ON "InventoryItems" (name);

-- RLS settings to allow open access for this application
-- （既存テーブルと同じ「全ユーザー許可」方針。anon キーでの直接アクセスを許可する）
ALTER TABLE public."Warehouses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public."Warehouses"
    FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON public."Warehouses"
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON public."Warehouses"
    FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON public."Warehouses"
    FOR DELETE USING (true);

ALTER TABLE public."InventoryItems" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public."InventoryItems"
    FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON public."InventoryItems"
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON public."InventoryItems"
    FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON public."InventoryItems"
    FOR DELETE USING (true);

-- === ストレージバケット: 在庫画像・倉庫位置図 ===
INSERT INTO storage.buckets (id, name, public)
VALUES ('inventory-images', 'inventory-images', true)
ON CONFLICT (id) DO NOTHING;

-- バケット内オブジェクトの操作を全ユーザーに許可（テーブルRLSと同方針）
CREATE POLICY "inventory images select" ON storage.objects
    FOR SELECT USING (bucket_id = 'inventory-images');
CREATE POLICY "inventory images insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'inventory-images');
CREATE POLICY "inventory images update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'inventory-images');
CREATE POLICY "inventory images delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'inventory-images');

-- === 倉庫マスタ初期データ（AppSheet 倉庫マスタより） ===
INSERT INTO "Warehouses" (name, display_order)
VALUES
    ('会社倉庫', 1),
    ('シャッター倉庫', 2),
    ('休憩所隣', 3),
    ('真城倉庫', 4),
    ('プレハブ倉庫', 5)
ON CONFLICT (name) DO NOTHING;
