import { supabase } from '../lib/supabase';

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
 * Parses and cleans item names using Gemini via Supabase Edge Functions
 * @param {Array<Object>} items - array of objects (Task items from Excel)
 * @returns {Promise<Array<Object>>} - original items mapped with optimized task names and exclude flag
 */
export async function optimizeItemsWithGemini(items) {
    if (!items || items.length === 0) return items;

    try {
        const { data, error } = await supabase.functions.invoke('gemini-optimize', {
            body: { items }
        });

        if (error) {
            console.error("Edge Function invocation returned error:", error);
            throw error;
        }

        if (!data || !data.result) {
            throw new Error("Invalid response data from Edge Function.");
        }

        const { result: parsedResult, usageMetadata } = data;

        if (usageMetadata) {
            updateDailyApiUsage(usageMetadata);
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
