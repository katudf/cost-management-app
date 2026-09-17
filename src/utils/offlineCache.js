// 作業日報システム（WorkerApp）のオフライン対応ユーティリティ。
// マスタデータのキャッシュと、未送信の日報下書きキューをlocalStorageで管理する。
//
// ドラフトキューの「同一性判定」と「積み下ろし」は純粋関数として
// draftQueueUtils が持っている。このファイルは localStorage への副作用だけを持つ。

import {
    draftKey,
    draftKeyOf,
    isSameDraftTarget,
    upsertIntoQueue,
    removeFromQueue,
} from './draftQueueUtils';

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
        // 空配列はキャッシュしない。未認証時に RLS が空を返すことがあり、
        // それを保存すると再読込後も空データを配り続けてしまうため。
        if (data && !(Array.isArray(data) && data.length === 0)) setCache(key, data);
        return { data, fromCache: false };
    } catch (e) {
        const cached = getCache(key);
        if (cached !== null) return { data: cached, fromCache: true };
        throw e;
    }
}

// ---------- 未送信ドラフトキュー（現場×日付単位） ----------

// 「現場+日付 が同じか」の判定と、キューへの追加/削除は draftQueueUtils が持ち主。
// ここは localStorage への読み書き（副作用）だけを担当する。
// draftKey は既存の import 元を壊さないために再輸出する。
export { draftKey };

/**
 * キューを localStorage から読む。壊れていれば空配列。
 */
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

/**
 * キューを localStorage に書く。
 *
 * ⚠️ ここで例外を外に出してはいけない。
 * `upsertDraft` は WorkerApp の送信失敗時 catch ブロックの中から呼ばれる。
 * QuotaExceededError がそのまま伝播すると catch の残り（未送信として保存した旨の
 * トースト表示）が丸ごと飛ばされ、作業員には「保存された」とも「失敗した」とも
 * 表示されないまま1日分の入力が消える。
 *
 * @returns {boolean} 書き込めたら true
 */
function saveDraftQueue(queue) {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        return true;
    } catch (e) {
        console.error('offlineCache: failed to save draft queue', e);
        return false;
    }
}

/**
 * ドラフトをキューに追加/上書き保存する（同一 現場+日付 は上書き）。
 *
 * @returns {{entry: object, saved: boolean}} `saved` が false なら localStorage に
 *   書けていない（容量超過など）。呼び出し側はユーザーに知らせること。
 */
export function upsertDraft(draft) {
    const entry = {
        ...draft,
        queueKey: draftKeyOf(draft),
        timestamp: new Date().toISOString(),
    };
    const saved = saveDraftQueue(upsertIntoQueue(getDraftQueue(), entry));
    return { entry, saved };
}

/**
 * 指定した 現場+日付 のドラフトをキューから削除する。
 *
 * @returns {{queue: object[], saved: boolean}} `saved` が false なら削除が
 *   localStorage に反映されていない（次回起動時に復活する）。
 */
export function removeDraft(projectId, date) {
    const queue = removeFromQueue(getDraftQueue(), projectId, date);
    const saved = saveDraftQueue(queue);
    return { queue, saved };
}

export function getDraft(projectId, date) {
    return getDraftQueue().find(d => isSameDraftTarget(d, projectId, date)) || null;
}

export function clearDraftQueue() {
    localStorage.removeItem(QUEUE_KEY);
}
