# 独自ログインIDへの切り替え 設計書

- 作成日: 2026-11-07（同日、レビュー指摘を反映して改訂）
- 状態: 設計確定・未実装
- 関連: [`security-permissions.md`](security-permissions.md)（ロール・RLS・共有アカウント方式 §3.3）

## 1. 目的と背景

現在のログインは Supabase Auth のメールアドレス＋パスワードで、担当者の追加は招待メール
（`invite-staff` Edge Function）、パスワードを忘れたときはメールでの再設定に頼っている。

**メールアドレスを持たない（または使わせたくない）担当者がいる**ため、管理者が発行する
独自のログインIDでログインできるようにする。移行後はメールアドレスでのログインを廃止し、
全員（担当者・作業員/閲覧者の共有アカウント・システム管理者アカウント）をIDに統一する。

## 2. 決定事項

| # | 論点 | 決定 |
|---|------|------|
| 1 | 実現方式 | IDを内部で架空メールアドレスに変換し、Supabase Auth をそのまま使う |
| 2 | 既存ユーザー | 全員IDに移行する（メールログインは移行期間後に廃止） |
| 3 | IDの決め方 | 管理者が自由に決める。半角英小文字・数字・`_`・`-` の3〜20文字 |
| 4 | パスワードの発行・リセット | 管理者がパスワードを直接入力して決める |
| 5 | 操作できる人 | admin は一般担当者（office）と共有アカウント（worker / viewer）まで。admin / system_admin の行は system_admin だけ |
| 6 | system_admin が忘れたとき | アプリに救済機能は作らず、Supabase 管理画面で再設定する（運用手順に記載） |
| 7 | 本人によるパスワード変更 | 担当者はログイン中に「現在のパスワード＋新しいパスワード」で変更できる。共有アカウントは画面に出さない |
| 8 | 移行手順 | 移行期間を設ける（メール・IDの併用 → 全員分の割り当て後にメール廃止） |
| 9 | IDの変更 | 管理者は変更できる（権限ルールは #5 と同じ）。本人は変更できない |
| 10 | 架空メールのドメイン | 自社ドメインのサブドメイン `login.kimura-paint.com` |
| 11 | 管理者の任命・解任 | **admin への昇格・admin からの降格、admin の行の紐付け変更・削除は system_admin だけ**（レビューで判明した乗っ取り経路をふさぐため。従来は admin 同士で可能だった） |

### 検討して採用しなかった案

- **電話番号ログイン**: SMS の送信費用と設定が必要。独自IDという要望にも合わない。
- **独自JWT発行（Edge Function で自前認証）**: RLS が依存する `auth.uid()` の扱いまで作り直しになり、工数とリスクが大きい。
- **仮パスワード＋初回変更の強制**: 決定 #4 により採用せず。ただし本人変更（#7）は用意する。
- **`office_staff.login_id` 列に写しを持つ**: Auth の email との二重管理になり、admin が REST から直接書き換えるとずれる。
  ID は Auth の email から導く方式にした（§3.2）。

## 3. 方式

### 3.1 IDと架空メールの対応

```
ログインID  : kimura01
Auth の email: kimura01@login.kimura-paint.com
```

- 変換は1か所の関数にまとめ、フロント（`src/utils/loginId.js` 新設）と Edge Function で同じ規則を使う。
  - 前後の空白を除き、小文字にする
  - 形式チェック: `^[a-z0-9_-]{3,20}$`
  - ドメインは定数 `LOGIN_ID_EMAIL_DOMAIN = 'login.kimura-paint.com'`
- DNS には Null MX（`login.kimura-paint.com. MX 0 .`、RFC 7505）を設定し、誤送信が外部に届かないことを明示する。
  ただし Supabase の拡張メール検証（MX 確認）が有効だと弾かれる可能性があるため §9 で確認する。
- 利用者の画面には架空メールを一切表示しない。

### 3.2 IDの保存場所（写しを持たない）

**正は Auth の email だけ**とし、`office_staff` に列は追加しない。

- 一覧表示用に、`get_office_staff_emails` を置き換える RPC `get_office_staff_login_ids()` を作る
  （SECURITY DEFINER、`is_admin()` のときだけ全行を返す。email が `@login.kimura-paint.com` で終わる行はドメインを外した ID、
  それ以外は NULL＝未割り当てとして返す）。
- 本人用に `get_my_login_id()` を作る（自分の行だけ）。本人変更（§4.3）の再認証や画面表示に使う。
- これにより、office ロールに全員のIDが見える問題（`office_staff_select` が office に全行を許している）も起きない。
- 重複は Auth の email の一意制約で防がれる。

### 3.3 ログイン

- `useAuth.signIn(loginId, password)` で ID → 架空メールに変換して `signInWithPassword` を呼ぶ。
- 移行期間中だけ、入力に `@` を含む場合はメールアドレスとしてそのまま渡す（§7 フェーズ1）。
- ログイン失敗時の文言は「IDまたはパスワードが違います」（ID の存在有無を区別しない）。
- ID は推測しやすいため、総当たり対策として Auth のログイン試行回数制限（`rate_limit.sign_in_sign_ups`）を確認する（§9）。

## 4. 画面

### 4.1 ログイン画面（`LoginScreen.jsx`）

- 入力欄のラベルを「ログインID」にする（`type="text"`、`autoComplete="username"`、`autoCapitalize="none"`）。
  フェーズ1では「ログインID（またはメールアドレス）」と表記する。
- **フェーズ2で**「パスワードを忘れた方」のメール再設定フォームを廃止し、
  「パスワードを忘れた場合は管理者に連絡してください」の案内文に置き換える
  （フェーズ1では未移行の人がメールで再設定できるよう残す）。
- 作業員・在庫・工程表の各アプリも同じ `LoginScreen` を使うので、まとめて変わる。

### 4.2 担当者設定（`StaffSettings.jsx`）

- メールアドレス表示（`Mail` アイコン）をログインID表示に置き換える。
- 行の状態ごとに出すボタン:

| 行の状態 | ボタン |
|----------|--------|
| Auth 未作成（`auth_user_id` が NULL） | 「ID発行」（ログインID・パスワード×2） |
| Auth あり・ID未割り当て（移行対象） | 「ID割り当て」（ログインID、パスワードは任意。招待未承諾の人は必須 → §5） |
| ID 割り当て済み | 「パスワードリセット」「ID変更」 |

- 操作できない行（admin が admin / system_admin の行を見ている場合）ではボタンを出さない。サーバー側（§5）でも必ず弾く。
- role の選択肢から ADMIN を外すのは admin ログイン時だけ（system_admin は選べる）。admin の行の role 欄は admin には読み取り専用にする（決定 #11）。
- system_admin でログインしているときだけ、system_admin の行（現状 id=17 のシステムアカウント）も一覧に出す。
  現在は `isDisplayableStaff` で全員に隠しているため、ID割り当て・リセットの経路がない。
- 検索はメールアドレスではなくログインIDを対象にする。
- 担当者の削除: `auth_user_id` がある行は Edge Function の `delete`（§5）経由にする。

### 4.3 パスワード変更（本人）

- 管理画面の設定に「パスワード変更」を追加する（現在のパスワード・新しいパスワード×2）。
- 共有アカウント（worker / viewer）の画面には出さない。
  **ただし `supabase.auth.updateUser` はクライアントから誰でも呼べるため、サーバー側では禁止できない**。
  共有アカウントのパスワード変更は履歴（§6）で検知する方針とする。
- 現在のパスワードの確認は、変更前に `signInWithPassword` で再認証して行う
  （Supabase の `updateUser` は既定では現在のパスワードを求めないため）。
  再認証に使うメールは `session.user.email` ではなく `get_my_login_id()` から組み立てる。
  ID割り当て直後はトークン更新（最大1時間）まで `session.user.email` が古い実メールのままのため。

### 4.4 パスワード再設定画面（`ResetPasswordScreen.jsx`）

- メールのリンクから開く経路（`PASSWORD_RECOVERY` / 招待リンク）がなくなるため、フェーズ2で
  `useAuth` の `isPasswordRecovery` まわりと合わせて撤去する（呼び出し元は §10）。

## 5. サーバー側（Edge Function）

`invite-staff` を `manage-staff-login`（仮名）に作り替える。処理の種類を `action` で受け取る。

| action | 入力 | 処理 |
|--------|------|------|
| `create` | staffId, loginId, password | `auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { office_staff_id } })` → `auth_user_id` を紐付け |
| `assign_login_id`（移行用） | staffId, loginId, password（任意） | 既存ユーザーの email を架空メールに書き換える。パスワードは指定時のみ変える。**招待未承諾（`email_confirmed_at` が NULL またはパスワード未設定）の人は password 必須** |
| `reset_password` | staffId, password | `auth.admin.updateUserById(id, { password })` |
| `change_login_id` | staffId, loginId | `auth.admin.updateUserById(id, { email, email_confirm: true })` |
| `delete` | staffId | Auth ユーザーを削除してから `office_staff` の行を削除する |

共通の検査（すべてサーバー側で行う）:

1. 呼び出し元がログイン済みで、`office_staff.role` が admin または system_admin。
2. 対象の行の role が admin / system_admin の場合、呼び出し元は system_admin であること。
   Edge Function での確認と DB 更新の間に role が変わる競合を防ぐため、更新用 RPC の中でも対象行を `FOR UPDATE` で読み直して再確認する。
3. ログインIDの形式チェック。
4. パスワードの最低長は8文字（Auth 側の `minimum_password_length` も8に上げて揃える。現在は6）。

`create` / `change_login_id` / `assign_login_id` で email が既に存在する場合（`email_exists`）は**必ず 409「このIDは既に使われています」**にし、
既存の Auth ユーザーに紐付けない。現行 `invite-staff` の「既存ユーザーを探して紐付ける」処理は流用しない
（第三者が先に signUp した架空メールのユーザーが担当者の行に紐付き、権限を得てしまうため）。
中断後の再試行で既存ユーザーを使う必要がある場合は、`app_metadata.office_staff_id` が対象の行と一致し、かつ未紐付けのときだけ許す。

DB の更新は、既存の `link_office_staff_auth_user` と同じく、トランザクションローカルの
`app.bypass_staff_protect_trigger` を立てる専用 RPC（service_role 専用、他ロールから EXECUTE 剥奪）で行う。
Auth 更新が成功して DB 更新が失敗した場合は Auth 側を元に戻す（create なら作ったユーザーを削除、
change_login_id なら元の email に戻す）。

### 5.1 保護トリガーの変更（決定 #11）

`protect_office_staff_privileged_columns` に次を加える（bypass フラグ時は従来どおり全判定を飛ばす）:

- UPDATE: `OLD.role = 'admin'` または `NEW.role = 'admin'` で role / auth_user_id が変わる場合は system_admin のみ
- DELETE: `OLD.role IN ('admin', 'system_admin')` は system_admin のみ
- DELETE: `OLD.auth_user_id IS NOT NULL` の行は bypass フラグがない限り拒否（§5 `delete` を経由させ、Auth ユーザーの取り残しを防ぐ）
- INSERT: `NEW.role = 'admin'` は system_admin のみ

## 6. パスワード変更履歴

`password_change_logs.kind` の CHECK 制約と `log_password_change` の許可値に種類を追加し、
`PASSWORD_CHANGE_KIND` / `PASSWORD_CHANGE_KIND_LABEL` も揃える。

| kind | 表示 | 記録する場所 |
|------|------|-------------|
| `recovery` | 再設定 | 既存（メール再設定）。フェーズ2以降は新規発生しない |
| `self` | 本人変更 | 本人変更の直後にフロントから `log_password_change('self')` |
| `admin_reset` | 管理者リセット | Edge Function から service_role 専用 RPC で記録。操作者を残すため `operator_staff_id` 列を追加する |

- 履歴に `login_id` 列を追加し、記録時点のIDを残す（担当者を削除しても、過去の実メールの行と区別して表示できるように）。
  画面（`PasswordChangeLogs.jsx`）は `login_id` があればそれを、なければ従来の `email` を表示する。
- 管理者リセット・ID発行の RPC では `password_change_log_state` の指紋も更新（upsert）する。
  しないと、リセット後に本人が `log_password_change('self')` を呼ぶだけで偽の「本人変更」が記録されてしまう。

## 7. 移行手順

### フェーズ1: 併用期間

1. **Supabase Auth の Email signups を無効にする**（本番）。架空メールのIDを第三者に先取りされないようにするため。
   管理者の `createUser` は無効でも動く。`supabase/config.toml` の `[auth] enable_signup` / `[auth.email] enable_signup` も false にする。
2. Auth の設定を合わせる: パスワード最低長を8、Secure password change が無効であること、パスワード変更・メール変更のセキュリティ通知メールを無効にする（§9）。
3. マイグレーション（RPC・保護トリガー・履歴の kind と列）を適用する。
4. Edge Function を配置し、担当者設定に ID 発行・割り当てを出す。
5. ログイン画面は「ログインID（またはメールアドレス）」表記にし、`@` を含む入力はメールとして受け付ける。
6. 管理者が既存の担当者・共有アカウントに `assign_login_id` でIDを割り当て、本人に口頭・紙で伝える。
   パスワードは原則変えない。admin / system_admin の行は system_admin が割り当てる。
7. **共有アカウント（worker / viewer）は割り当てと同時にパスワードも変える**。
   現在のパスワードが `security-permissions.md` に平文で記載されているため。あわせて文書から削除する。
   なお管理者によるパスワード変更で既存セッションが失効する場合、現場の全端末で再ログインが必要になる（§9）。
   作業員への周知と同時に行う。
8. 新規の担当者はこの時点から `create`（ID発行）で作る。招待メールは使わない。

注意: `assign_login_id` を実行した時点でその人の email は架空メールに変わるため、
**その人は元のメールアドレスではログインできなくなる**。割り当てと同時に本人へIDを伝える運用にする。

### フェーズ2: メール廃止

`get_office_staff_login_ids()` で未割り当て（NULL）が0件であることを確認してから行う。

1. ログイン画面の `@` 判定を削除する（IDのみ）。
2. `resetPasswordForEmail`・招待リンク判定・`ResetPasswordScreen` を撤去する。
3. `get_office_staff_emails` RPC と `useStaffSettingsData.js` のメール取得を撤去する。
4. Supabase Auth の Redirect URLs の招待・再設定用エントリを整理する。
5. ドキュメントを更新する（§10）。

## 8. 運用手順（system_admin のパスワードを忘れたとき）

1. Supabase ダッシュボード → Authentication → Users を開く。
2. `<ログインID>@login.kimura-paint.com` のユーザーを探し、パスワードを再設定する。
3. 再設定した旨を本人に伝え、ログイン後に本人変更（§4.3）で変えてもらう。

system_admin は現状 id=17 のシステムアカウント1つだけで、画面から2人目は作れない。
そのため**前提は「Supabase ダッシュボードにログインできる人を2人以上置く」**とする。この手順は運用マニュアルにも載せる。

## 9. 実装前に確認すること（本番の Supabase で）

- [ ] Email signups が無効になっていること（ローカルの `config.toml` は有効）
- [ ] `email_confirm: true` を付けた `createUser` / `updateUserById(email)` が、確認メールを送らずに即時反映されること
- [ ] 管理者がパスワードを変えたとき、対象者の既存セッション（他端末）がどうなるか。
      失効する場合 → 共有アカウントのリセットで現場の全端末がログアウトされる（§7-7 の周知に反映）。
      失効しても、発行済みのアクセストークンは最大1時間（`jwt_expiry`）有効なので、即座の締め出しにはならない
- [ ] Secure password change が無効であること（有効だと `updateUser` がメール再認証を求め、架空メールでは完了できない）
- [ ] パスワード変更・メール変更のセキュリティ通知メールが無効であること（架空ドメインへの送信で SMTP の評価が下がるのを防ぐ）
- [ ] 拡張メール検証（MX 確認）の有無と、Null MX のドメインで `createUser` が通ること
- [ ] パスワード最低長を8にしたこと、ログイン試行回数制限の値
- [ ] `login.kimura-paint.com` の DNS（Null MX、ワイルドカード A レコードがないこと）を DNS の管理者に確認
- [ ] パスワードマネージャー・ブラウザの保存済みパスワードが、ID切り替え後も正しく候補に出るか（`autoComplete="username"`）

## 10. 影響範囲

| ファイル | 変更内容 |
|----------|----------|
| `src/utils/loginId.js`（新規） | ID の正規化・形式チェック・架空メール変換 |
| `src/hooks/useAuth.jsx` | ID→メール変換、本人パスワード変更。フェーズ2で再設定・招待リンク処理（18-19, 69-91行付近）を撤去 |
| `src/utils/constants.js` | `PASSWORD_CHANGE_KIND` / `_LABEL` に `SELF` / `ADMIN_RESET` を追加 |
| `src/components/auth/LoginScreen.jsx` | 入力欄をIDに。フェーズ2で再設定フォームを案内文に |
| `src/components/auth/ResetPasswordScreen.jsx` | フェーズ2で撤去 |
| `src/AdminApp.jsx` / `WorkerApp.jsx` / `InventoryApp.jsx` / `ScheduleViewApp.jsx` | フェーズ2で `ResetPasswordScreen` / `isPasswordRecovery` の分岐を撤去 |
| `src/components/tabs/StaffSettings.jsx` | ID表示・発行・割り当て・リセット・ID変更・削除、admin 行の扱い |
| `src/hooks/useStaffSettingsData.js` | Edge Function の呼び出しとID取得 RPC への差し替え |
| `src/components/tabs/settings/PasswordChangeLogs.jsx` / `src/hooks/usePasswordChangeLogs.js` | ログインID・種類・操作者の表示 |
| `supabase/functions/invite-staff/` | `manage-staff-login` に作り替え |
| `supabase/migrations/`（新規） | ID取得 RPC、更新用 RPC、保護トリガー（§5.1）、履歴の kind・`operator_staff_id`・`login_id` 列 |
| `supabase/config.toml` | signups 無効、パスワード最低長8 |
| `docs/design.md` | 114-120行付近と §7「Supabase Auth / Edge Functions」（478-491行付近） |
| `docs/specs/security-permissions.md` | 共有アカウントの平文パスワードの削除、ログイン方式・管理者任命ルールの更新 |
| `docs/manuals/`（admin / worker / role-overview） | ログイン方法・ID発行・パスワードリセットの手順 |

## 11. テスト

- Vitest: `loginId.js` の正規化（大文字・前後空白）、形式チェック（境界の2/3/20/21文字、使えない文字）、メール変換
- DB（`tests/db` の流儀）:
  - admin が office / worker / viewer の行を操作できる
  - admin が admin / system_admin の行を操作できない（role 変更・紐付け変更・削除・ID操作）
  - admin が admin を office に降格できない（降格→リセットの抜け道）
  - office・本人が role / auth_user_id を変えられない
  - `auth_user_id` がある行を直接 DELETE できない
  - `get_office_staff_login_ids()` が admin 以外に行を返さない
  - 管理者リセット後に `log_password_change('self')` を呼んでも記録されない
- E2E: ID でのログイン、フェーズ1の `@` 入力でのログイン
