import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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

