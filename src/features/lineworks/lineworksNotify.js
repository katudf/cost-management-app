import { supabase } from '../../lib/supabase';

/**
 * LINE WORKS Bot 通知を送信する。
 * 認証情報は Edge Functions の Secrets に保持しているため、必ず Function 経由で呼び出す。
 *
 * @param {string} message 送信するテキスト（1000文字以内）
 * @param {number[]} [workerIds] 宛先の作業員ID。省略時は在籍中の作業員全員。
 * @returns {Promise<{sentCount:number, failedCount:number, failed:{name:string,error:string}[]}>}
 */
export async function sendLineWorksNotification(message, workerIds) {
    const { data, error } = await supabase.functions.invoke('lineworks-notify', {
        body: { message, workerIds },
    });

    if (error) {
        // Edge Function が返した JSON のエラーメッセージを優先して拾う
        let detail = '';
        try {
            detail = (await error.context?.json())?.error ?? '';
        } catch {
            detail = '';
        }
        throw new Error(detail || error.message || '通知の送信に失敗しました。');
    }
    if (data?.error) throw new Error(data.error);

    return data;
}

/** LINE WORKS 通知の有効/無効を取得する。 */
export async function fetchLineWorksEnabled() {
    const { data, error } = await supabase
        .from('system_settings')
        .select('lineworks_enabled')
        .eq('id', 1)
        .maybeSingle();

    if (error) throw error;
    return data?.lineworks_enabled ?? false;
}

/** LINE WORKS 通知の有効/無効を保存する。system_settings は id=1 の固定行。 */
export async function saveLineWorksEnabled(enabled) {
    const { error } = await supabase
        .from('system_settings')
        .update({ lineworks_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', 1);

    if (error) throw error;
}

/** 作業員の LINE WORKS ユーザーID一覧を取得する（在籍中のみ）。 */
export async function fetchWorkerLineWorksIds() {
    const { data, error } = await supabase
        .from('Workers')
        .select('id, name, lineworks_user_id, display_order')
        .is('resignation_date', null)
        .order('display_order', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

/** 作業員1名の LINE WORKS ユーザーIDを保存する。空文字は未設定(null)として扱う。 */
export async function saveWorkerLineWorksId(workerId, lineworksUserId) {
    const value = lineworksUserId?.trim() ? lineworksUserId.trim() : null;
    const { error } = await supabase
        .from('Workers')
        .update({ lineworks_user_id: value })
        .eq('id', workerId);

    if (error) throw error;
}
