-- Phase 0-f: Storage オープンポリシーの整理
DROP POLICY IF EXISTS "inventory images select" ON storage.objects;
DROP POLICY IF EXISTS "Allow all actions" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
