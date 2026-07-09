-- office_staffにログイン連携用のauth_user_idを追加
-- Supabase Auth (auth.users) のユーザーとoffice_staffレコードを1:1で紐付ける
-- NULL許容: ログインを持たない担当者（見積書上の表示名のみ等）も引き続き許容する
ALTER TABLE office_staff
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS office_staff_auth_user_id_key
  ON office_staff (auth_user_id)
  WHERE auth_user_id IS NOT NULL;
