import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    taskOrderStorageKey,
    loadSavedTaskOrder,
    sortByOrder,
    applyTaskOrder,
    saveTaskOrder,
} from './taskOrderUtils';

/**
 * vitest.config.ts の environment は 'node' なので localStorage が存在しない。
 * 実装が try/catch で握り潰す挙動まで含めて確かめたいので、
 * 本物に近い最小のスタブを立てる（jsdom に切り替えると他の suite にも影響するため）。
 */
const createStorageStub = () => {
    const store = new Map<string, string>();
    return {
        store,
        getItem: vi.fn((k: string) => (store.has(k) ? (store.get(k) as string) : null)),
        setItem: vi.fn((k: string, v: string) => { store.set(k, v); }),
        removeItem: vi.fn((k: string) => { store.delete(k); }),
        clear: vi.fn(() => { store.clear(); }),
    };
};

let storage: ReturnType<typeof createStorageStub>;

beforeEach(() => {
    storage = createStorageStub();
    vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const t = (id: string | number) => ({ id, name: `task-${id}` });

describe('taskOrderStorageKey', () => {
    it('プロジェクトidごとに異なるキーになること', () => {
        expect(taskOrderStorageKey(12)).toBe('cost-app-worker-task-order-12');
        expect(taskOrderStorageKey(13)).not.toBe(taskOrderStorageKey(12));
    });

    it('数値idと文字列idが同じキーになること（保存と読み込みで型が揺れても一致する）', () => {
        expect(taskOrderStorageKey(12)).toBe(taskOrderStorageKey('12'));
    });
});

describe('loadSavedTaskOrder', () => {
    it('未保存なら null を返すこと', () => {
        expect(loadSavedTaskOrder(1)).toBeNull();
    });

    it('projectId が無ければ localStorage を読まずに null を返すこと', () => {
        expect(loadSavedTaskOrder(null)).toBeNull();
        expect(loadSavedTaskOrder(undefined)).toBeNull();
        expect(loadSavedTaskOrder('')).toBeNull();
        expect(storage.getItem).not.toHaveBeenCalled();
    });

    it('保存済みの配列を文字列の配列として返すこと', () => {
        storage.store.set('cost-app-worker-task-order-1', JSON.stringify([3, 1, 2]));
        expect(loadSavedTaskOrder(1)).toEqual(['3', '1', '2']);
    });

    it('JSONとして壊れていれば null を返すこと（例外を投げない）', () => {
        storage.store.set('cost-app-worker-task-order-1', '{壊れている');
        expect(loadSavedTaskOrder(1)).toBeNull();
    });

    it('配列でないJSONが入っていれば null を返すこと', () => {
        storage.store.set('cost-app-worker-task-order-1', JSON.stringify({ a: 1 }));
        expect(loadSavedTaskOrder(1)).toBeNull();
    });

    it('localStorage 自体が例外を投げても null を返すこと', () => {
        storage.getItem.mockImplementation(() => { throw new Error('SecurityError'); });
        expect(loadSavedTaskOrder(1)).toBeNull();
    });
});

describe('sortByOrder', () => {
    it('保存順どおりに並べ替えること', () => {
        const items = [t(1), t(2), t(3)];
        expect(sortByOrder(items, ['3', '1', '2']).map(x => x.id)).toEqual([3, 1, 2]);
    });

    it('savedOrder が null なら元の配列をそのまま返すこと', () => {
        const items = [t(1), t(2)];
        expect(sortByOrder(items, null)).toBe(items);
    });

    it('savedOrder が空配列なら元の配列をそのまま返すこと', () => {
        const items = [t(1), t(2)];
        expect(sortByOrder(items, [])).toBe(items);
    });

    it('元の配列を破壊しないこと', () => {
        const items = [t(1), t(2), t(3)];
        sortByOrder(items, ['3', '2', '1']);
        expect(items.map(x => x.id)).toEqual([1, 2, 3]);
    });

    it('保存順に無い項目は元の相対順を保ったまま末尾に回ること', () => {
        // 4 と 5 は保存順に無い新規項目。元の並びでは 5 が先。
        const items = [t(5), t(1), t(4), t(2)];
        expect(sortByOrder(items, ['2', '1']).map(x => x.id)).toEqual([2, 1, 5, 4]);
    });

    it('保存順に載っている項目が1つも無ければ元の順序が保たれること', () => {
        const items = [t(7), t(8), t(9)];
        expect(sortByOrder(items, ['1', '2']).map(x => x.id)).toEqual([7, 8, 9]);
    });

    it('数値idと文字列idが混ざっていても一致させられること', () => {
        const items = [t('2'), t(1), t(3)];
        expect(sortByOrder(items, ['3', '2', '1']).map(x => x.id)).toEqual([3, '2', 1]);
    });

    it('保存順に既に存在しない項目が含まれていても無視されること', () => {
        // 99 は削除済みの作業。残っている項目の相対順は保存順どおり。
        const items = [t(2), t(1)];
        expect(sortByOrder(items, ['99', '1', '2']).map(x => x.id)).toEqual([1, 2]);
    });

    it('空配列を渡しても空配列を返すこと', () => {
        expect(sortByOrder([], ['1'])).toEqual([]);
    });
});

describe('applyTaskOrder', () => {
    it('保存済みの順序を読み込んで適用すること', () => {
        storage.store.set('cost-app-worker-task-order-7', JSON.stringify([3, 1, 2]));
        const items = [t(1), t(2), t(3)];
        expect(applyTaskOrder(items, 7).map(x => x.id)).toEqual([3, 1, 2]);
    });

    it('未保存なら元の配列をそのまま返すこと', () => {
        const items = [t(1), t(2)];
        expect(applyTaskOrder(items, 7)).toBe(items);
    });

    it('projectId が無ければ元の配列をそのまま返すこと', () => {
        const items = [t(1), t(2)];
        expect(applyTaskOrder(items, null)).toBe(items);
    });

    it('別の現場の並び順に影響されないこと', () => {
        storage.store.set('cost-app-worker-task-order-7', JSON.stringify([3, 2, 1]));
        const items = [t(1), t(2), t(3)];
        expect(applyTaskOrder(items, 8).map(x => x.id)).toEqual([1, 2, 3]);
    });
});

describe('saveTaskOrder', () => {
    it('idの配列を文字列にして保存すること', () => {
        saveTaskOrder([t(3), t(1), t(2)], 7);
        expect(storage.store.get('cost-app-worker-task-order-7')).toBe(JSON.stringify(['3', '1', '2']));
    });

    it('projectId が無ければ書き込まないこと', () => {
        saveTaskOrder([t(1)], null);
        saveTaskOrder([t(1)], undefined);
        saveTaskOrder([t(1)], '');
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('localStorage が例外を投げても呼び出し側に伝播しないこと', () => {
        storage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
        expect(() => saveTaskOrder([t(1)], 7)).not.toThrow();
    });

    it('保存した順序が applyTaskOrder で復元できること（往復）', () => {
        saveTaskOrder([t(3), t(1), t(2)], 7);
        expect(applyTaskOrder([t(1), t(2), t(3)], 7).map(x => x.id)).toEqual([3, 1, 2]);
    });

    it('空配列を保存しても読み込み側で元の順序が保たれること', () => {
        saveTaskOrder([], 7);
        const items = [t(1), t(2)];
        expect(applyTaskOrder(items, 7)).toBe(items);
    });
});
