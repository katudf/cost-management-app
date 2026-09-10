-- 印影バケットを非公開化し、staff のみ参照・office のみ書き込み可とする
UPDATE storage.buckets SET public = false WHERE id = 'stamps';

CREATE POLICY "stamps_select_staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'stamps' AND is_staff());

CREATE POLICY "stamps_insert_office" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'stamps' AND (is_admin() OR current_staff_role() = 'office'));

-- アップロードは upsert: true のため UPDATE も必要
CREATE POLICY "stamps_update_office" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'stamps' AND (is_admin() OR current_staff_role() = 'office'))
  WITH CHECK (bucket_id = 'stamps' AND (is_admin() OR current_staff_role() = 'office'));

CREATE POLICY "stamps_delete_office" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'stamps' AND (is_admin() OR current_staff_role() = 'office'));
