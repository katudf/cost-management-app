import { GoogleGenerativeAI } from '@google/generative-ai';

const TRACKING_KEY = 'gemini-api-daily-usage';

export function getDailyApiUsage() {
    const today = new Date().toISOString().split('T')[0];
    const stored = localStorage.getItem(TRACKING_KEY);
    if (stored) {
        try {
            const data = JSON.parse(stored);
            if (data.date === today) {
                return data;
            }
        } catch (e) {
            console.error('Failed to parse API usage data', e);
        }
    }
    return { date: today, requestCount: 0, totalTokens: 0, limitRequests: 1500, limitTokens: 1000000 };
}

function updateDailyApiUsage(usageMetadata) {
    if (!usageMetadata || !usageMetadata.totalTokenCount) return;
    
    const current = getDailyApiUsage();
    current.requestCount += 1;
    current.totalTokens += usageMetadata.totalTokenCount;
    
    localStorage.setItem(TRACKING_KEY, JSON.stringify(current));
}

/**
 * Parses and cleans item names using Gemini
 * @param {Array<Object>} items - array of objects (Task items from Excel)
 * @param {string} apiKey - Gemini API Key
 * @returns {Promise<Array<Object>>} - original items mapped with optimized task names and exclude flag
 */
export async function optimizeItemsWithGemini(items, apiKey) {
    if (!apiKey) throw new Error("Gemini API key is missing.");
    if (!items || items.length === 0) return items;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

    // Extract just the names to keep the prompt small
    const itemNames = items.map((item, index) => ({
        index,
        name: item.task
    }));

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
`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
            }
        });
        
        if (result.response.usageMetadata) {
            updateDailyApiUsage(result.response.usageMetadata);
        }
        
        const text = result.response.text();
        let parsedResult;
        try {
            parsedResult = JSON.parse(text);
        } catch (e) {
            // Handle edge case where model wraps response in Markdown
            const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsedResult = JSON.parse(cleanedText);
        }

        // Merge back into original items array
        const finalItems = items.map((item, i) => {
            const aiData = parsedResult.find(p => p.index === i);
            if (aiData) {
                return {
                    ...item,
                    originalTask: item.task,
                    task: aiData.optimized || item.task,
                    isExcluded: aiData.isExcluded || false
                };
            }
            return item; // Fallback to original if not found
        });

        return finalItems;

    } catch (error) {
        console.error("Gemini Optimization Error:", error);
        throw error;
    }
}
