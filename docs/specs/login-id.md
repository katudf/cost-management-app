# 独自ログインIDへの切り替え 設計書

- 作成日: 2026-11-07（同日、レビュー指摘を反映して改訂）
- 状態: フェーズ1を本番に公開済み（2026-11-07、PR #3）。Auth 設定・マイグレーション（`20261107000000` / `20261107010000`）・Edge Function `manage-staff-login`・画面のすべてを反映。既存ユーザーへのID割り当て（§7 フェーズ1）は未着手。フェーズ2は未着手
- 実装: `src/utils/loginId.js`、`supabase/migrations/20261107000000_login_id_management.sql`、
  `supabase/functions/manage-staff-login/`、`src/components/tabs/settings/StaffLoginDialog.jsx` / `OwnPasswordChange.jsx`。
  テストは `src/utils/loginId.test.js` と `scripts/test-login-id-db.py`（`tests/db/login-id-fixture.sql`）
- 実装で設計から変えた点:
  - 履歴には `operator_staff_id` に加えて `operator_staff_name` も残す（操作した管理者を削除しても名前が残るように）
  - `invite-staff` はフェーズ1では残し（画面からは呼ばない）、フェーズ2で削除する
  - 権限の再確認は RPC `assert_can_manage_staff_login` にまとめ、`link_staff_login` / `delete_staff_with_login` /
    `log_admin_password_reset` の中でも呼ぶ。ID割り当て・ID変更は Auth を書き換えたあとにもう一度確かめ、
    権限が無くなっていたら元のメールに戻す。パスワードリセットは戻せないので、記録時の再確認で失敗したら
    「システム管理者がもう一度リセットしてください」と返す
  - 削除は「Auth ユーザーを BAN → 担当者の行を消す → Auth ユーザーを消す」の順。
    先に Auth ユーザーを消すと `ON DELETE SET NULL` による更新が保護トリガーに止められ、
    BAN しないと Auth ユーザーの削除に失敗したときに担当者のいないログインが使える状態で残るため。
    行の削除に失敗したら BAN を解く
  - 本人のパスワード変更（§4.3）は、Supabase の「Require current password when updating」に加えて、
    変更前に現在のパスワードでログインし直して確かめる（設定がオフでも確認されるように）。
    ログイン用メールは `getUser()` でサーバーから取り直す
  - Edge Function の処理本体は `handler.ts` に分け、`handler.test.ts`（Vitest）で偽のクライアントを使ってテストする
  - 架空メールのドメインは SQL では `login_id_email_domain()` 1か所にまとめ、画面・Edge Function の値との一致を
    DB テストと `handler.test.ts` で確かめる
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
| 10 | 架空メールのドメイン | 予約ドメイン `login.invalid`（当初は自社サブドメインの予定だったが、heteml の DNS では Null MX を登録できないため変更。§9.1） |
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
Auth の email: kimura01@login.invalid
```

- 変換は1か所の関数にまとめ、フロント（`src/utils/loginId.js` 新設）と Edge Function で同じ規則を使う。
  - 前後の空白を除き、小文字にする
  - 形式チェック: `^[a-z0-9_-]{3,20}$`
  - ドメインは定数 `LOGIN_ID_EMAIL_DOMAIN = 'login.invalid'`
- `.invalid` は RFC 2606 で「決して存在しない」と定められたトップレベルドメインなので、万一メールが送られてもどこにも届かず、DNS の設定も要らない。
  Supabase の管理者 API は書式しか確かめないため登録できる（§9.1）。実装時に1件作って最終確認する（§9.3）。
- 利用者の画面には架空メールを一切表示しない。

### 3.2 IDの保存場所（写しを持たない）

**正は Auth の email だけ**とし、`office_staff` に列は追加しない。

- 一覧表示用に、`get_office_staff_emails` を置き換える RPC `get_office_staff_login_ids()` を作る
  （SECURITY DEFINER、`is_admin()` のときだけ全行を返す。email が `@login.invalid` で終わる行はドメインを外した ID、
  それ以外は NULL＝未割り当てとして返す）。
- 本人用に `get_my_login_id()` を作る（自分の行だけ）。画面に自分のIDを表示するのに使う。
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
- 現在のパスワードの確認は、Supabase の「Require current password when updating」をオンにして
  `updateUser({ password, current_password })` で行う（§9.2）。サーバー側で確認されるので、
  クライアントから直接 `updateUser` を呼ばれても現在のパスワードなしでは変えられない。
  `current_password_mismatch` のときは「現在のパスワードが違います」と表示する。
  あわせて、変更の前に現在のパスワードで `signInWithPassword` し直して確かめる（設定がオフの間も確認されるように）。
  そのときのメールは `getUser()` でサーバーから取り直す（ID割り当て直後は `session.user.email` が古いメールのままのため）

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
2. Auth の設定を合わせる（§9.2）: パスワード最低長を8に上げ、「Require current password when updating」をオンにする。
   Secure password change はオフのまま、セキュリティ通知メールもオフのままにする。`supabase/config.toml` も同じ値にする。
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

ダッシュボードの Authentication → Users には、パスワードを直接設定する操作がない（2026-11-07 確認。
あるのは再設定メール・マジックリンク・BAN・削除などで、メールは架空ドメインなので届かない）。そのため SQL Editor で設定する。

1. Supabase ダッシュボード → SQL Editor を開く（組織メンバーの Owner / Administrator / Developer なら実行できる）。
2. 次を実行する（`<ログインID>` と仮パスワードを置き換える）。

   ```sql
   update auth.users
   set encrypted_password = extensions.crypt('仮パスワード', extensions.gen_salt('bf')),
       updated_at = now()
   where email = '<ログインID>@login.invalid';
   ```

   「1 row affected」と出れば成功。0件なら ID の綴りを確認する。
3. 仮パスワードを本人に伝え、ログイン後すぐに本人変更（§4.3）で変えてもらう。
4. SQL Editor のスニペットは「Save」を押さない限り保存されない（2026-11-07 時点）。仮パスワードを含む SQL は保存せず、
   実行後はタブを閉じて破棄する（保存してしまった場合は削除する）。
   この方法はパスワード変更履歴（§6）に記録されない。

system_admin は現状 id=17 のシステムアカウント1つだけで、画面から2人目は作れない。
そのため**前提は「Supabase ダッシュボードにログインできる人を2人以上置く」**とする。この手順は運用マニュアルにも載せる。

2026-11-07 時点で Supabase の組織メンバーは Owner の1人だけで、この前提を満たしていない。
**フェーズ1を始める前に、社内のもう1人を組織メンバー（Administrator）に招待する**（Owner が Organization → Team → Invite members から行う）。
組織は Free プランなので、役割は組織全体に効く（同じ組織の別プロジェクト `film-thickness` にも同じ権限で入れる）。

## 9. 実装前に確認すること（本番の Supabase で）

2026-11-07 に確認した。本番プロジェクト `quaollobtalcixmlpmps` の Auth は v2.188.1。
Supabase Auth の挙動は同じバージョンのソース（github.com/supabase/auth タグ v2.188.1）で確かめた。

### 9.0 フェーズ1を始める前に済ませること

- [x] Supabase の組織メンバーに2人目を追加する（§8。2026-11-07 追加）
- [x] §7-1・§7-2 の Auth 設定変更（2026-11-07 本番に適用・再読み込みで確認済み）
  - 新規登録: 無効（`disable_signup: true`）
  - Minimum password length: 8
  - Require current password when updating: オン
  - Secure password change: オフのまま

### 9.1 確認済み

| 項目 | 結果 | 確認方法 | 設計への影響 |
|------|------|----------|--------------|
| Email signups | **有効**（`disable_signup: false`、`mailer_autoconfirm: false`） | 本番 `/auth/v1/settings` | §7-1 で必ず無効にする。確認メール必須なので先取りされても直接ログインはできないが、架空メールの枠は埋まり、そのIDで `create` できなくなる |
| signups 無効時の管理者 `createUser` | 使える | ソース `signup.go:115` だけが `DisableSignup` を確認。`admin.go` は確認しない | 変更なし |
| 管理者の `updateUserById({ email, email_confirm: true })` | すぐに書き換わり、メールは送られない。Secure email change の設定の影響を受けない。セッションは失効しない | ソース `admin.go:198-199, 248`。管理者 API に送信処理がない | `change_login_id` / `assign_login_id` は利用者側の操作なしで完了する。割り当て後も既存のセッションは続く（§4.3 のとおり、`session.user.email` は古いまま） |
| 管理者の `updateUserById({ password })` | **対象者の全セッションとリフレッシュトークンが失効する** | ソース `admin.go:211` → `models/user.go:377-379` `Logout` → `sessions.go:343` | 共有アカウントのパスワードを変えると、現場の全端末が再ログインになる（§7-7）。発行済みのアクセストークンは期限（`jwt_expiry`、最大1時間）まで残る。そこで画面側（`useAuth.jsx`）で、画面に戻ったとき（30秒おき以上）と表示中は5分おきに `getUser()` を呼び、`session_not_found` ならログアウトする（プレビューで、リセット後も別ウィンドウが残ることを確認して追加） |
| 利用者の `updateUser({ password })` | 他の端末のセッションは失効し、今の端末だけ残る。**現在のパスワードは既定では求められない** | ソース `api/user.go:170, 215-220` | §4.3 のとおり、「Require current password when updating」をオンにしてサーバー側で確認させる（§9.2） |
| 管理者 API でのセキュリティ通知メール | 送られない | ソース `admin.go` に通知の呼び出しがない | 管理者の発行・リセット・ID変更では架空ドメインに送信されない |
| 管理者 API でのメールアドレス検査 | 書式チェックだけで、DNS は引かない | ソース `mail.go:708-720` | DNS に存在しない `login.invalid` でも ID発行・変更は通る |
| 自社サブドメインを使う場合の DNS | `login.kimura-paint.com` は MX がなく、ワイルドカード A レコード（`*.kimura-paint.com` → 157.7.189.246）に一致する。ネームサーバーは heteml（`dns0.heteml.jp`）で、heteml のネームサーバーでは**レコードを個別に設定できない**（heteml ヘルプ「レコードの設定（編集）方法を教えて」） | `nslookup`（8.8.8.8）、heteml ヘルプ | Null MX を置けないため、自社サブドメインはやめて `login.invalid` にした（決定 #10） |

### 9.2 管理画面で確認した設定（2026-11-07、閲覧のみ・変更なし）

| 項目（ダッシュボードの場所） | 現在値 | 判断 |
|------------------------------|--------|------|
| Secure password change（Sign In / Providers → Email） | **オフ** | このままでよい。オンだと、ログインから24時間を超えたセッションでの本人変更にメールの確認コードが必要になり、架空メールでは完了できない（ソース `api/user.go:151-160`） |
| Require current password when updating（同上） | **オフ** | **§7-2 でオンにする**。`updateUser({ password, current_password })` の確認をサーバー側で強制できる（§4.3）。メールの再設定リンクから入ったセッションは確認が免除されるので（ソース `api/user.go:171-180`）、フェーズ1のメール再設定も壊れない |
| Secure email change（同上） | オン | 管理者 API には影響しない（§9.1）。変更不要 |
| Minimum password length（同上） | **6** | §7-2 で8に上げる |
| Password requirements（同上） | 指定なし | 必要に応じて検討（必須ではない） |
| Prevent use of leaked passwords（同上） | オフ | Pro プラン以上のみ。対象外 |
| セキュリティ通知メール 7種（Emails → Security） | **すべてオフ** | このままでよい。架空ドメインへの送信は起きない |
| SMTP（Emails → SMTP Settings） | 組み込みのメール送信（独自 SMTP なし） | 架空ドメインへの送信で評価が下がる心配はない。フェーズ1の招待・再設定メールは従来どおり組み込みの送信制限を受ける |
| サインアップ・サインインの試行回数制限（Rate Limits） | 5分あたり30回／IP（1時間あたり360回） | 現状のままとする。IDは推測しやすいので、運用で不審なログイン失敗が多ければ下げる |
| 招待済みでパスワード未設定のユーザー（Users） | **0人**（全9ユーザーが作成済み・ログイン履歴あり） | `assign_login_id` でパスワード必須になる対象は、今のところいない |

### 9.3 その他

- [ ] 実装時に、本番で `<ID>@login.invalid` のユーザーを1件作成・ログイン・削除できることを確かめる
- [ ] パスワードマネージャー・ブラウザの保存済みパスワードが、ID切り替え後も正しく候補に出るか（`autoComplete="username"`）。実装後に確認する

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
