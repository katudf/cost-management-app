import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Gemini の課金枠を守るため、呼び出せるのは管理者画面のロール（admin/system_admin/office）に限る
const ALLOWED_ROLES = ['admin', 'system_admin', 'office']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on the server.")
      return new Response(
        JSON.stringify({ error: "サーバー側の設定が不足しています。" }),
        { status: 500, headers: jsonHeaders }
      )
    }

    // 呼び出し元のログインを検証する（トークンを明示して getUser に渡す）
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) {
      return new Response(
        JSON.stringify({ error: "認証情報がありません。" }),
        { status: 401, headers: jsonHeaders }
      )
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
    if (callerError || !callerData?.user) {
      return new Response(
        JSON.stringify({ error: "ログイン情報が確認できません。再度ログインしてください。" }),
        { status: 401, headers: jsonHeaders }
      )
    }

    const { data: callerStaff, error: callerStaffError } = await adminClient
      .from('office_staff')
      .select('role')
      .eq('auth_user_id', callerData.user.id)
      .maybeSingle()
    if (callerStaffError) throw callerStaffError
    if (!callerStaff || !ALLOWED_ROLES.includes(callerStaff.role)) {
      return new Response(
        JSON.stringify({ error: "この操作を行う権限がありません。" }),
        { status: 403, headers: jsonHeaders }
      )
    }

    const { items } = await req.json()

    const apiKey = Deno.env.get("GEMINI_API_KEY")
    if (!apiKey) {
      console.error("GEMINI_API_KEY environment variable is not set on the server.");
      return new Response(
        JSON.stringify({ error: "Gemini API key is not configured in Edge Functions." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (!items || !Array.isArray(items)) {
      return new Response(
        JSON.stringify({ error: "Invalid items payload." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Extract task names to minimize token usage
    const itemNames = items.map((item: any, index: number) => ({
      index,
      name: item.task
    }))

    const prompt = `
あなたは建設・建築業界の見積書などの項目名を整理する専門家です。
以下のリストは、Excel等から読み込んだ項目名の配列です。それぞれについて、現場の作業員が見て分かりやすいように、以下のルールに従って最適化してください。

【ルール】
1. 冗長で長すぎる項目名は、一般的に通じる短く分かりやすい名称に短縮してください。
   （例：「仮設工事 一式仮設 足場組み立て作業 〇〇仕様」 → 「仮設工事 足場組立」など）
2. 既に十分に短い場合は、無理に短縮せずそのままにしてください。
3. 間接経費（諸経費、現場管理費、共通仮設費など）、値引きなど、現場の作業実績（何時間作業したか）を記録するシステムに登録不要とみなされるものは「isExcluded: true」としてマークしてください。
4. 全ての入力項目に対して結果を返してください。配列の要素数は入力と一致する必要があります。
5. 返答は以下のJSON配列フォーマットに厳密に従ってください。前後のマークダウン（\`\`\`json）を含めないでください。

[
  { "index": 0, "original": "元の名前", "optimized": "短縮・整理後の名前", "isExcluded": boolean },
  ...
]

【対象データ】
${JSON.stringify(itemNames, null, 2)}
`

    // Call Google Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        }
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error("Gemini API error response:", errText)
      throw new Error(`Gemini API returned status ${response.status}`)
    }

    const resultData = await response.json()
    const text = resultData.candidates?.[0]?.content?.parts?.[0]?.text
    const usageMetadata = resultData.usageMetadata || null

    if (!text) {
      throw new Error("No response text returned from Gemini API")
    }

    let parsedResult
    try {
      parsedResult = JSON.parse(text)
    } catch (e) {
      // Handle edge cases where Gemini API wraps the response in Markdown block
      const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsedResult = JSON.parse(cleanedText)
    }

    return new Response(
      JSON.stringify({ result: parsedResult, usageMetadata }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    )

  } catch (error: any) {
    console.error("Error in gemini-optimize function:", error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    )
  }
})

