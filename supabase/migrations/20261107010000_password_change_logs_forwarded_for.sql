-- 本番の password_change_logs に forwarded_for 列が無かった（20261026100000 の列追加前の版が適用されていた）。
-- 20261107000000 で入れ替えた log_password_change / log_admin_password_reset はこの列に書き込むため、
-- 本番ではパスワード変更履歴の記録が失敗していた（パスワードの変更自体は成功している）。
-- 列があれば何もしない。
ALTER TABLE public.password_change_logs ADD COLUMN IF NOT EXISTS forwarded_for text;
