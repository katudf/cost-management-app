import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages } from './fetchAllPages';

// range(from, to) を受けて rows の該当範囲を返す疑似クエリ
const makeBuilder = (rows, failAtFrom = null) => {
    const calls = [];
    const buildQuery = vi.fn(() => ({
        range: async (from, to) => {
            calls.push([from, to]);
            if (failAtFrom === from) return { data: null, error: { message: 'boom' } };
            return { data: rows.slice(from, to + 1), error: null };
        },
    }));
    return { buildQuery, calls };
};

describe('fetchAllPages', () => {
    it('上限を超える件数をページに分けてすべて取得する', async () => {
        const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
        const { buildQuery, calls } = makeBuilder(rows);
        const { data, error } = await fetchAllPages(buildQuery, 10);
        expect(error).toBeNull();
        expect(data).toHaveLength(25);
        expect(calls).toEqual([[0, 9], [10, 19], [20, 29]]);
    });

    it('ちょうどページ数の倍数のときは空ページで終わる', async () => {
        const rows = Array.from({ length: 20 }, (_, i) => ({ id: i }));
        const { buildQuery, calls } = makeBuilder(rows);
        const { data } = await fetchAllPages(buildQuery, 10);
        expect(data).toHaveLength(20);
        expect(calls).toHaveLength(3);
    });

    it('途中でエラーになったら error を返す', async () => {
        const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
        const { buildQuery } = makeBuilder(rows, 10);
        const { data, error } = await fetchAllPages(buildQuery, 10);
        expect(data).toBeNull();
        expect(error).toEqual({ message: 'boom' });
    });
});
