import { describe, it, expect, beforeEach } from 'vitest';
import { migrateLegacyWorkerKeys, workerStorageKey, projectStorageKey, readJson, writeJson } from './safeStorage';

// vitest の環境は node なので、最小限の localStorage を用意する
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

describe('migrateLegacyWorkerKeys', () => {
    beforeEach(() => store.clear());

    it('以前のキーの選択を今の人のキーへ移し、以前のキーを消す', () => {
        store.set('cost-app-worker', '{"id":3,"name":"田中"}');
        store.set('cost-app-worker-project', '12');
        migrateLegacyWorkerKeys('uid-1');
        expect(readJson(workerStorageKey('uid-1'))).toEqual({ id: 3, name: '田中' });
        expect(store.get(projectStorageKey('uid-1'))).toBe('12');
        expect(store.has('cost-app-worker')).toBe(false);
        expect(store.has('cost-app-worker-project')).toBe(false);
    });

    it('今の人のキーに既に選択があれば上書きしない（以前のキーは消す）', () => {
        writeJson(workerStorageKey('uid-1'), { id: 5 });
        store.set('cost-app-worker', '{"id":3}');
        migrateLegacyWorkerKeys('uid-1');
        expect(readJson(workerStorageKey('uid-1'))).toEqual({ id: 5 });
        expect(store.has('cost-app-worker')).toBe(false);
    });

    it('ログインしていなければ何もしない', () => {
        store.set('cost-app-worker', '{"id":3}');
        migrateLegacyWorkerKeys('');
        expect(store.has('cost-app-worker')).toBe(true);
    });
});

describe('readJson', () => {
    beforeEach(() => store.clear());

    it('壊れた値は null', () => {
        store.set('k', '{oops');
        expect(readJson('k')).toBeNull();
        expect(readJson('missing')).toBeNull();
    });
});
