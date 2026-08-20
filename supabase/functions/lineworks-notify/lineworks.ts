// LINE WORKS API 呼び出しの共通処理。
// Service Account + JWT(RS256) でアクセストークンを取得し、Bot メッセージを送信する。
// 参考: https://developers.worksmobile.com/jp/docs/auth-jwt
//       https://developers.worksmobile.com/jp/docs/bot-user-message-send

const AUTH_URL = "https://auth.worksmobile.com/oauth2/v2.0/token"
const API_BASE = "https://www.worksapis.com/v1.0"

/** base64url エンコード（JWT 用。パディングと +/ を除去する） */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * PEM 形式の秘密鍵(PKCS#8)を CryptoKey に変換する。
 * Secrets には改行が \n という2文字で入りがちなので、実際の改行へ戻してから処理する。
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\n/g, "\n").trim()
  const body = normalized
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "")

  if (!body) throw new Error("LINEWORKS_PRIVATE_KEY の形式が不正です。")

  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
}

export interface LineWorksConfig {
  clientId: string
  clientSecret: string
  serviceAccount: string
  privateKey: string
  botId: string
}

/** Secrets から設定を読み込む。不足があれば分かるようにキー名を列挙して投げる。 */
export function loadConfig(): LineWorksConfig {
  const entries = {
    clientId: Deno.env.get("LINEWORKS_CLIENT_ID"),
    clientSecret: Deno.env.get("LINEWORKS_CLIENT_SECRET"),
    serviceAccount: Deno.env.get("LINEWORKS_SERVICE_ACCOUNT"),
    privateKey: Deno.env.get("LINEWORKS_PRIVATE_KEY"),
    botId: Deno.env.get("LINEWORKS_BOT_ID"),
  }

  const missing = Object.entries(entries)
    .filter(([, v]) => !v)
    .map(([k]) => `LINEWORKS_${k.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}`)

  if (missing.length > 0) {
    throw new Error(
      `LINE WORKS の設定が不足しています（Edge Functions の Secrets を確認してください）: ${missing.join(", ")}`,
    )
  }
  return entries as LineWorksConfig
}

/** Service Account の JWT を生成して署名する。有効期限は仕様上の上限60分より短い20分にする。 */
async function createAssertion(config: LineWorksConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: "RS256", typ: "JWT" }
  const payload = {
    iss: config.clientId,
    sub: config.serviceAccount,
    iat: now,
    exp: now + 60 * 20,
  }

  const encoder = new TextEncoder()
  const signingInput =
    base64UrlEncode(encoder.encode(JSON.stringify(header))) +
    "." +
    base64UrlEncode(encoder.encode(JSON.stringify(payload)))

  const key = await importPrivateKey(config.privateKey)
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  )

  return signingInput + "." + base64UrlEncode(new Uint8Array(signature))
}

// アクセストークンはインスタンスが生きている間だけ再利用する。
// Edge Function は頻繁に停止するため、あくまで同一実行内での重複取得を防ぐ目的。
let cachedToken: { value: string; expiresAt: number } | null = null

export async function getAccessToken(config: LineWorksConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }

  const assertion = await createAssertion(config)
  const body = new URLSearchParams({
    assertion,
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "bot",
  })

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`LINE WORKS のアクセストークン取得に失敗しました (${res.status}): ${text}`)
  }

  const json = JSON.parse(text)
  const expiresIn = Number(json.expires_in) || 3600
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  return cachedToken.value
}

/** Bot から個人トークへテキストメッセージを送信する。 */
export async function sendTextMessage(
  config: LineWorksConfig,
  token: string,
  userId: string,
  text: string,
): Promise<void> {
  const url = `${API_BASE}/bots/${encodeURIComponent(config.botId)}/users/${encodeURIComponent(userId)}/messages`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: { type: "text", text } }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`送信失敗 (${res.status}): ${detail}`)
  }
}
