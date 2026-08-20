# LINE WORKS 連携（Bot通知）｜ 開発ハンドオフ仕様書

> **ステータス: 実装完了・保留中（2026-08-19時点）**
> コード・DBマイグレーションはすべて完了しています。
> 残っているのは **LINE WORKS 側の管理コンソール操作** と **Supabase への認証情報登録** のみです。
>
> **保留理由: 作業者に LINE WORKS の副管理者権限がまだ付与されていないため。**
> 権限付与後、本書の「§5 再開手順」から作業を再開してください。

---

## 1. 目的・スコープ

工事原価管理システムから、LINE WORKS の Bot 経由で**作業員全員へテキストメッセージを一斉送信**する機能。

- 契約状況: LINE WORKS 有料プラン契約済み
- 今回の位置づけ: **試験導入**（「とりあえず動く形を見る」段階）
- 宛先: LINE WORKS ID を登録した在籍中の作業員全員
- 送信操作: 管理者画面 → システム設定 → LINE WORKS タブから手動送信

### 今回のスコープ外

- 日報未提出リマインド等の自動通知・定期実行
- Bot からの受信（Callback / 双方向のやり取り）
- トークルーム（グループ）への送信 — 現状は個人宛のみ
- テキスト以外のメッセージタイプ（画像・リンク・ボタン等）

---

## 2. アーキテクチャ

### 認証情報をフロントエンドに置かない理由

LINE WORKS の Client Secret と RSA 秘密鍵は、Vite の `VITE_*` 環境変数に置くと**ビルド成果物にそのまま埋め込まれ、ブラウザから読み取れてしまいます**。
本プロジェクトで Gemini API キーを Supabase Edge Functions の Secrets へ移行したのと同じ理由により、**LINE WORKS の認証情報もすべて Edge Function 側に閉じ込めています**。

そのため、設定画面には認証情報の入力欄を一切設けていません（画面上にもその旨の注意書きを表示しています）。

### 処理フロー

```
[ブラウザ] システム設定 → LINE WORKS タブ
    │  supabase.functions.invoke('lineworks-notify', { message })
    ↓
[Edge Function] lineworks-notify
    │  1. Authorization ヘッダを検証（未ログインなら401）
    │  2. office_staff.role === 'admin' を確認（管理者以外は403）
    │  3. message を検証（空でない / 1000文字以内）
    │  4. system_settings.lineworks_enabled が true か確認
    │  5. Workers から宛先を取得
    │       lineworks_user_id が NOT NULL かつ resignation_date IS NULL
    │  6. JWT(RS256) を生成 → アクセストークン取得（scope: bot）
    │  7. 宛先ごとに Bot API へ POST（1件失敗しても他は継続）
    ↓
[LINE WORKS] https://www.worksapis.com/v1.0/bots/{botId}/users/{userId}/messages
```

### 認証（Service Account + JWT）

| 項目 | 値 |
|------|-----|
| トークン取得先 | `POST https://auth.worksmobile.com/oauth2/v2.0/token` |
| grant_type | `urn:ietf:params:oauth:grant-type:jwt-bearer` |
| JWT 署名方式 | RS256（Deno Web Crypto の `RSASSA-PKCS1-v1_5` + SHA-256） |
| JWT クレーム | `iss` = Client ID / `sub` = Service Account ID / `iat` / `exp` |
| `exp` の設定 | `iat + 20分`（LINE WORKS の上限は60分） |
| scope | `bot` |
| トークンキャッシュ | 関数インスタンス内でメモリ保持。期限1分前に再取得 |

### メッセージ送信

| 項目 | 値 |
|------|-----|
| エンドポイント | `POST https://www.worksapis.com/v1.0/bots/{botId}/users/{userId}/messages` |
| `{userId}` | LINE WORKS のユーザーID **またはメールアドレス**（URLエンコードして埋め込む） |
| リクエストボディ | `{"content": {"type": "text", "text": "本文"}}` ← **`content` のラップが必須** |
| 成功時 | HTTP **201** |

> ⚠️ ボディ形式は公式ドキュメントの `bot-send-text` で確認済みです。`content` ラッパーを外すと送信に失敗します。

---

## 3. 実装済みの内容

### 3-1. DBマイグレーション（本番プロジェクトへ適用済み）

[`supabase/migrations/20260819000000_add_lineworks_integration.sql`](../supabase/migrations/20260819000000_add_lineworks_integration.sql)

| テーブル | 追加カラム | 型 | 用途 |
|---------|-----------|-----|------|
| `Workers` | `lineworks_user_id` | `text` (nullable) | LINE WORKS のユーザーIDまたはメールアドレス。**NULL の作業員は送信対象外** |
| `system_settings` | `lineworks_enabled` | `boolean not null default false` | 通知機能のON/OFF。`id=1` の固定行 |

`add column if not exists` を使っているため再実行しても安全です。
**適用済みであることは本番プロジェクト（`quaollobtalcixmlpmps`）で確認済み**です。

### 3-2. Edge Function

```
supabase/functions/lineworks-notify/
├── index.ts        エントリポイント（認可・入力検証・宛先解決・一括送信）
├── lineworks.ts    JWT生成 / トークン取得 / メッセージ送信
└── deno.json       import map（@supabase/supabase-js）
```

**`index.ts` の要点**

- CORS プリフライト対応
- `Authorization` ヘッダ必須 → `auth.getUser()` で呼び出し元を特定
- `office_staff.role === 'admin'` でない場合は 403（`invite-staff` 関数と同じ認可パターン）
- `lineworks_enabled` が false なら送信せずエラーを返す
- `Promise.all` + 宛先ごとの try/catch により、**1名分が失敗しても他の送信は継続**
- レスポンス: `{ success, sentCount, failedCount, failed: [{ name, error }] }`
- リクエストで `workerIds`（配列）を渡すと宛先を絞り込める。省略時は対象者全員

**`lineworks.ts` の要点**

- `loadConfig()` が5つの環境変数を読み込み、欠けていればエラー
- `importPrivateKey()` は PEM 内の**リテラル `\n` を実際の改行へ正規化**する
  （Secrets 登録時に改行が `\n` 文字列に化けても動作します）

### 3-3. フロントエンド

| ファイル | 内容 |
|---------|------|
| [`src/features/lineworks/lineworksNotify.js`](../src/features/lineworks/lineworksNotify.js) | Supabase 呼び出しの集約層。UIから直接 `supabase.from()` を呼ばない規約に準拠 |
| [`src/components/tabs/settings/LineWorksSettings.jsx`](../src/components/tabs/settings/LineWorksSettings.jsx) | 設定画面UI（3カード構成） |
| [`src/components/tabs/SystemSettingsTab.jsx`](../src/components/tabs/SystemSettingsTab.jsx) | LINE WORKS サブタブを追加（`MessageSquare` アイコン） |

**`lineworksNotify.js` のエクスポート**

| 関数 | 役割 |
|------|------|
| `sendLineWorksNotification(message, workerIds)` | Edge Function を呼び出す。エラー本文を取り出して `Error` にする |
| `fetchLineWorksEnabled()` | `system_settings.lineworks_enabled` を取得 |
| `saveLineWorksEnabled(enabled)` | 同上を UPDATE（`id=1` 固定行のため INSERT はしない） |
| `fetchWorkerLineWorksIds()` | 在籍中の作業員を `display_order` 順に取得 |
| `saveWorkerLineWorksId(workerId, id)` | 1名分を UPDATE。空文字は NULL として保存 |

**設定画面の構成（3カード）**

1. **有効/無効トグル** — チェックすると即座にDBへ反映。認証情報は Edge Functions の Secrets で管理する旨の注意書き（黄色）を表示
2. **作業員の LINE WORKS ID 一覧** — ローカル状態で編集し、**変更のあった行だけ**まとめて保存。送信対象人数をリアルタイム表示
3. **メッセージ送信** — 1000文字上限＋文字数カウンタ。送信前に `useConfirm()` で確認ダイアログを表示。トグルOFF・本文空・対象0名のいずれかでボタンは無効

規約準拠: `window.confirm` 不使用（`useConfirm()` を使用）／エラーは `showToast(..., 'error')`／入力欄に `aria-label` 付与。

### 3-4. 検証済みの内容

| 検証 | 結果 |
|------|------|
| マイグレーションの本番適用 | ✅ 成功 |
| 追加カラムの型確認（`execute_sql`） | ✅ `lineworks_user_id` text / `lineworks_enabled` boolean |
| `resignation_date` / `display_order` の実在確認 | ✅ 関数の前提と一致 |
| `npx vite build` | ✅ 成功（1771 modules） |
| 設定画面のレンダリング | ✅ 3セクションと空状態を確認 |
| JWT の RS256 署名検証（Denoテスト） | ✅ PASS（公開鍵で検証成功、`exp - iat = 1200秒`） |
| 送信リクエストの組み立て（Denoテスト） | ✅ PASS（URL・Authorizationヘッダ・ボディ形式を確認） |

**未検証: LINE WORKS 実サービスへの実送信**（認証情報未取得のため）。

---

## 4. 残作業（保留中）

作業者に **LINE WORKS の副管理者権限が未付与**のため、以下すべてが未着手です。

| # | 作業 | 必要な権限 |
|---|------|-----------|
| ① | Developer Console でアプリ登録・Service Account 発行・秘密鍵ダウンロード・Bot 作成 | LINE WORKS 管理者権限 |
| ② | 管理者画面で Bot を「サービス中」にする | LINE WORKS 管理者権限 |
| ③ | Supabase Edge Functions の Secrets に5つの値を登録 | Supabase プロジェクト権限 |
| ④ | Edge Function のデプロイ | Supabase プロジェクト権限 |
| ⑤ | アプリ側で有効化してテスト送信 | システムの管理者アカウント |

> ⚠️ 補足: Developer Console の**委任アプリの作成・更新・削除は Super Admin のみ**が実行できると公式ドキュメントに記載があります。
> 副管理者権限で①が完結しない可能性があるため、権限付与時に**アプリ作成の可否も併せて確認**してください。

---

## 5. 再開手順

### ① Developer Console でアプリと Bot を作る

**アクセス先:** https://developers.worksmobile.com/jp/console/

**1-1. アプリを新規作成**

アプリを作成すると **Client ID / Client Secret が自動発行**されます（**後から変更できません**）。作成後、アプリ設定画面で以下を実施します。

| やること | 取得するもの |
|---|---|
| OAuth Scope に **`bot`** を追加 | — |
| **Service Account を発行** | Service Account ID（`xxxxx.serviceaccount@ドメイン` 形式） |
| **秘密鍵（Private Key）を発行しダウンロード** | PEMファイル（`-----BEGIN PRIVATE KEY-----` で始まる） |
| 画面に表示されている値をコピー | Client ID / Client Secret |

> ⚠️ **秘密鍵はダウンロードできるのが発行時の1回だけです。** 紛失した場合は再発行になります。安全な場所に保管してください。
> ※ Service Account を発行すると、その時点で管理者へ通知が送られます（仕様）。

**1-2. Bot を新規作成**

同じ Developer Console の Bot メニューから作成します。

| 項目 | 入力内容 |
|------|---------|
| Bot名（必須） | 例: 原価管理システム通知 |
| 説明（必須） | 例: 工事原価管理システムからの連絡通知 |
| 主担当（必須） | 管理者アカウント |
| Callback URL（任意） | **空欄でOK**（送信専用のため受信不要） |
| トークルームへの招待 | 今回は不要 |

作成すると **Bot ID**（数字）が発行されます。

**この時点で揃う5つの値:** Client ID / Client Secret / Service Account ID / 秘密鍵 / Bot ID

---

### ② 管理者画面で Bot を「サービス中」にする ← 最重要

> 🔴 **Developer Console で Bot を作成しただけでは、メッセージは届きません。**
> Developer Console への登録はテナント単位の登録に過ぎず、この段階の Bot は状態が **「準備中」** です。
> 管理者画面からドメインに追加して初めて **「サービス中」** となり、メンバーが受信できるようになります。

**LINE WORKS 管理者画面** (https://admin.worksmobile.com/) にログインし、

> **サービス** → **Bot** → **「Bot 追加」**

ダイアログで Developer Console 登録済みの Bot を選択して追加し、状態が **「サービス中」** になったことを目視確認してください。

> 💡 「設定は正しいのに通知が届かない」というトラブルは、ほぼこの手順の漏れが原因です。

---

### ③ Supabase に Secrets を登録する

Supabase ダッシュボード → プロジェクト `quaollobtalcixmlpmps` → **Edge Functions** → **Secrets**

| Secret 名 | 登録する値 |
|---|---|
| `LINEWORKS_CLIENT_ID` | ①の Client ID |
| `LINEWORKS_CLIENT_SECRET` | ①の Client Secret |
| `LINEWORKS_SERVICE_ACCOUNT` | ①の Service Account ID |
| `LINEWORKS_PRIVATE_KEY` | 秘密鍵ファイルの中身**全体**（BEGIN行〜END行まで） |
| `LINEWORKS_BOT_ID` | ①の Bot ID（数字のみ） |

秘密鍵の改行はそのまま貼り付けて構いません（関数側で改行を正規化しています）。
CLI から登録する場合:

```bash
npx supabase secrets set LINEWORKS_BOT_ID=xxxxxxx --project-ref quaollobtalcixmlpmps
```

秘密鍵は複数行のため、GUI からの登録を推奨します。

---

### ④ Edge Function をデプロイする

プロジェクトルートで実行します。

```bash
npx supabase functions deploy lineworks-notify --project-ref quaollobtalcixmlpmps
```

Docker が未導入の環境では、サーバー側でバンドルする `--use-api` を付けてください。

```bash
npx supabase functions deploy lineworks-notify --use-api --project-ref quaollobtalcixmlpmps
```

ダッシュボードの Edge Functions 一覧に `lineworks-notify` が表示されれば成功です。

---

### ⑤ アプリで有効化してテスト送信

1. `npm run dev` でアプリを起動し、**管理者アカウント**でログイン
2. **システム設定** タブ → **LINE WORKS** タブを開く
3. **「LINE WORKS 通知を有効にする」にチェック**を入れる
4. 作業員の LINE WORKS ID 欄に、まず**自分（管理者）のアカウントだけ**を入力して保存
   - 値は LINE WORKS の**メールアドレス**（例: `taro@example.com`）でOK
5. メッセージを入力して「送信する」
6. 自分の LINE WORKS に Bot からメッセージが届けば成功 → その後、残りの作業員IDを登録

> 💡 いきなり全員分を登録せず、**自分1人でテスト**してから展開してください。誤送信を防げます。

---

## 6. トラブルシューティング

| 症状 | 確認すること |
|------|-------------|
| 「サーバー側の設定が不足しています」 | ③の Secrets 5つが揃っているか。名前のスペルミス |
| 「この操作には管理者権限が必要です」 | ログイン中のアカウントが `office_staff.role = 'admin'` か |
| 「LINE WORKS通知が無効です」系 | 設定画面のトグルがONか（`system_settings.lineworks_enabled`） |
| **エラーは出ないが届かない** | **②で「サービス中」になっているか**（最頻出）。次に宛先IDがテナントに実在するか |
| 401 / `invalid_grant` | 秘密鍵の貼り付けミス（BEGIN/END行の欠落）、Service Account ID の誤り |
| 送信対象が0名のまま | 作業員の `lineworks_user_id` が空。または `resignation_date` が入っていて退職扱い |

送信ログは Supabase ダッシュボード → **Edge Functions → lineworks-notify → Logs** で確認できます。

---

## 7. 今後の拡張候補

- 日報未提出リマインドの自動送信（`pg_cron` + Edge Function）
- 配置表確定時に、担当作業員へ翌日の現場情報を自動通知
- トークルーム（グループ）宛の送信
- Flex 形式のメッセージで、アプリの該当画面へのリンクを添付
- 送信履歴テーブルを設けて、いつ誰に何を送ったかを記録

---

## 8. 参考リンク

- [LINE WORKS Developer Console](https://developers.worksmobile.com/jp/console/)
- [LINE WORKS 管理者画面](https://admin.worksmobile.com/)
- [API ドキュメント（日本語）](https://developers.worksmobile.com/jp/docs/api)
- Bot メッセージ送信 / Service Account 認証の各項目は上記ドキュメント内 `bot` / `auth` セクションを参照
