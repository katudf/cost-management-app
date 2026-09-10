-- LINE WORKS 連携（Bot通知）
-- 作業員と LINE WORKS ユーザーを紐付けるための列を追加する。
-- lineworks_user_id には LINE WORKS のユーザーIDまたはメールアドレスを保存する。
alter table public."Workers"
  add column if not exists lineworks_user_id text;

comment on column public."Workers".lineworks_user_id is
  'LINE WORKS のユーザーIDまたはメールアドレス。Bot通知の宛先解決に使用する。未設定の作業員は通知対象外。';

-- Bot通知機能のON/OFF（システム設定 id=1 の固定行に付与）
alter table public.system_settings
  add column if not exists lineworks_enabled boolean not null default false;

comment on column public.system_settings.lineworks_enabled is
  'LINE WORKS Bot通知の有効/無効。認証情報は Edge Functions の Secrets で管理する。';
