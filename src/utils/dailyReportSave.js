/**
 * 作業員画面の日報送信（DB 関数 save_daily_report）まわりの補助関数。
 */

/**
 * 画面側で行の id を先に決めるための UUID を作る。
 * 協力業者の追加ではこの値をそのまま DB の id にするため、再送しても二重登録にならない。
 * crypto.randomUUID が無い環境（非 HTTPS など）では Math.random で同じ形式を作る。
 */
export function newClientUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/** 通信できなかった（＝下書きに退避して後で再送すべき）エラーか。 */
export function isNetworkSaveError(error, online = true) {
    if (!online) return true;
    const message = error?.message || '';
    return message.includes('fetch') || message.includes('Network');
}

/**
 * 通信以外で保存に失敗したときに作業員へ見せる文言。
 * DB 関数が日本語で理由を返すもの（権限・入力不正・対象なし）は、その理由をそのまま見せる。
 * これを「電波の良いところで」と案内すると、何度再送しても直らないため。
 */
export function describeSaveError(error) {
    switch (error?.code) {
        case '23505':
            return '同じ作業項目に、開始時刻が同じ時間枠が重複しています。時刻を確認してから送信してください。';
        case '42501':
            return `保存できませんでした: ${error.message}（現場の職長が変わった場合は、画面を読み込み直してください）`;
        case '22023':
        case 'P0002':
            return `保存できませんでした: ${error.message}`;
        default:
            return '保存に失敗しました。電波の良いところで再度お試しください。';
    }
}
