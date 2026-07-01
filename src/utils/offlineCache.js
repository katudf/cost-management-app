// 作業日報システム（WorkerApp）のオフライン対応ユーティリティ。
// マスタデータのキャッシュと、未送信の日報下書きキューをlocalStorageで管理する。

const CACHE_PREFIX = 'cost-app-cache-';
const QUEUE_KEY = 'cost-app-draft-queue';

// ---------- マスタデータキャッシュ ----------

/**
 * キャッシュへ書き込む。取得成功時に呼び出す。
 */
export function setCache(key, data) {
    try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, cachedAt: new Date().toISOString() }));
    } catch (e) {
        console.error('offlineCache: failed to write cache', key, e);
    }
}

/**
 * キャッシュから読み出す。存在しなければ null。
 */
export function getCache(key) {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed.data;
    } catch (e) {
        return null;
    }
}

export function getCacheTimestamp(key) {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        return JSON.parse(raw).cachedAt || null;
    } catch (e) {
        return null;
    }
}

/**
 * Supabaseクエリを実行し、成功したらキャッシュを更新、
 * 失敗（またはオフライン）ならキャッシュへフォールバックする。
 * @param {string} key - キャッシュキー
 * @param {() => Promise<{data, error}>} fetcher - Supabase呼び出し
 * @returns {Promise<{data: any, fromCache: boolean}>}
 */
export async function fetchWithCache(key, fetcher) {
    if (!navigator.onLine) {
        const cached = getCache(key);
        if (cached !== null) return { data: cached, fromCache: true };
    }
    try {
        const { data, error } = await fetcher();
        if (error) throw error;
        if (data) setCache(key, data);
        return { data, fromCache: false };
    } catch (e) {
        const cached = getCache(key);
        if (cached !== null) return { data: cached, fromCache: true };
        throw e;
    }
}

// ---------- 未送信ドラフトキュー（現場×日付単位） ----------

function draftKey(projectId, date) {
    return `${projectId}__${date}`;
}

export function getDraftQueue() {
    try {
        const raw = localStorage.getItem(QUEUE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function saveDraftQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * ドラフトをキューに追加/上書き保存する（同一 現場+日付 は上書き）。
 */
export function upsertDraft(draft) {
    const key = draftKey(draft.selectedProjectId, draft.selectedDate);
    const queue = getDraftQueue();
    const idx = queue.findIndex(d => draftKey(d.selectedProjectId, d.selectedDate) === key);
    const entry = { ...draft, queueKey: key, timestamp: new Date().toISOString() };
    if (idx >= 0) {
        queue[idx] = entry;
    } else {
        queue.push(entry);
    }
    saveDraftQueue(queue);
    return entry;
}

/**
 * 指定した 現場+日付 のドラフトをキューから削除する。
 */
export function removeDraft(projectId, date) {
    const key = draftKey(projectId, date);
    const queue = getDraftQueue().filter(d => draftKey(d.selectedProjectId, d.selectedDate) !== key);
    saveDraftQueue(queue);
    return queue;
}

export function getDraft(projectId, date) {
    const key = draftKey(projectId, date);
    return getDraftQueue().find(d => draftKey(d.selectedProjectId, d.selectedDate) === key) || null;
}

export function clearDraftQueue() {
    localStorage.removeItem(QUEUE_KEY);
}
