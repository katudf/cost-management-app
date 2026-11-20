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
 *
 * 承認・作業項目の追加など、日報の保存以外の DB 関数の失敗にも使う。
 * @param {object} error  Supabase のエラー
 * @param {object} [options]
 * @param {string} [options.action='保存']  「〇〇できませんでした」の〇〇
 * @param {string} [options.fallback]       DB が理由を返さなかったときの文言
 */
export function describeSaveError(error, { action = '保存', fallback } = {}) {
    switch (error?.code) {
        case '23505':
            return '同じ作業項目に、開始時刻が同じ時間枠が重複しています。時刻を確認してから送信してください。';
        case '42501':
            return `${action}できませんでした: ${error.message}（現場の職長が変わった場合は、画面を読み込み直してください）`;
        case '22023':
        case 'P0002':
        // 他の人が先に直していた（楽観ロックの競合。DB が HTTP 409 で返す独自のコード）
        case 'PT409':
            return `${action}できませんでした: ${error.message}`;
        default:
            return fallback ?? `${action}に失敗しました。電波の良いところで再度お試しください。`;
    }
}

/** 他の人が先に直していた（save_daily_report / approve_* の楽観ロックの競合）か。 */
export function isConflictError(error) {
    return error?.code === 'PT409';
}

/**
 * save_daily_report に送る expected_versions（{ "<record_id>": "<画面が読んだ updated_at>" }）を作る。
 * 版が分からない行（DB の更新前に読んだ行など）は入れない（その行は比べずに保存される）。
 * @param {Iterable<number|string>} recordIds  削除・更新する行の id
 * @param {Map<string, string>} versions        id（文字列）→ 読み込んだときの updated_at
 * @returns {Record<string, string>}
 */
export function buildExpectedVersions(recordIds, versions) {
    const expected = {};
    for (const id of recordIds) {
        const key = String(id);
        const version = versions.get(key);
        if (version) expected[key] = version;
    }
    return expected;
}

/**
 * 職長が送る進捗。読み込んだときから変えた作業項目だけを、読み込んだときの値（expected_progress）と一緒に送る。
 * 全項目を送ると、画面を開いた後に管理者が直した進捗を古い値で上書きしてしまうため。
 * 読み込んだときの値を持たない作業項目（古い下書きから復元したものなど）は、比べずに送る。
 * @param {{ id: number, progress_percentage?: number|null, saved_progress?: number|null }[]} tasks
 */
export function buildProgressPayload(tasks) {
    return tasks
        .filter(t => !('saved_progress' in t) || (t.progress_percentage || 0) !== (t.saved_progress || 0))
        .map(t => ('saved_progress' in t
            ? { id: t.id, progress_percentage: t.progress_percentage, expected_progress: t.saved_progress ?? null }
            : { id: t.id, progress_percentage: t.progress_percentage }));
}
