// localStorage の読み書き。プライベートモード・容量超過などで使えなくても例外を出さない
// （画面は端末保存なしでも動くようにしておく）。

export const readStorage = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
};

export const writeStorage = (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
};

export const removeStorage = (key) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
};

export const readJson = (key) => {
    const raw = readStorage(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
};

export const writeJson = (key, value) => writeStorage(key, JSON.stringify(value));

// ---------- 作業日報・在庫アプリの「選んだ作業員・現場」 ----------
// ログインしている人（Auth ユーザー）ごとに分ける。別の人のログインに持ち越さない（docs/specs/worker-login.md §4.2）。
export const workerStorageKey = (authUserId) => `cost-app-worker:${authUserId || ''}`;
export const projectStorageKey = (authUserId) => `cost-app-worker-project:${authUserId || ''}`;

// 2026-11-07 より前の保存キー（ログインしている人で分けていなかった）
const LEGACY_WORKER_KEY = 'cost-app-worker';
const LEGACY_PROJECT_KEY = 'cost-app-worker-project';

/**
 * 以前のキーに残っている選択を、今ログインしている人のキーへ移して、以前のキーは消す。
 * 共有アカウントの端末で、リリース後に名前と現場を選び直さなくて済むようにする。
 */
export const migrateLegacyWorkerKeys = (authUserId) => {
    if (!authUserId) return;
    [[LEGACY_WORKER_KEY, workerStorageKey(authUserId)], [LEGACY_PROJECT_KEY, projectStorageKey(authUserId)]]
        .forEach(([legacyKey, newKey]) => {
            const legacy = readStorage(legacyKey);
            if (legacy === null) return;
            if (readStorage(newKey) === null) writeStorage(newKey, legacy);
            removeStorage(legacyKey);
        });
};
