import { describe, it, expect } from 'vitest';
import { applyTargetNinku, restoreNinkuEntry, createLatestGuard } from './ninkuState';

describe('applyTargetNinku', () => {
    it('消化人工を保ったまま目標人工だけを書き換える', () => {
        const map = { 1: { consumedNinku: 12.5, targetNinku: 400 } };
        const next = applyTargetNinku(map, 1, 414);
        expect(next[1]).toEqual({ consumedNinku: 12.5, targetNinku: 414 });
        expect(map[1].targetNinku).toBe(400); // 元の状態は変えない
    });

    it('未取得の現場は消化0として作る', () => {
        expect(applyTargetNinku({}, 2, 59)[2]).toEqual({ consumedNinku: 0, targetNinku: 59 });
    });
});

describe('restoreNinkuEntry', () => {
    it('保存に失敗したら元の値に戻す', () => {
        const previous = { consumedNinku: 3, targetNinku: 100 };
        const edited = applyTargetNinku({ 1: previous }, 1, 999);
        expect(restoreNinkuEntry(edited, 1, previous)[1]).toEqual(previous);
    });

    it('元の値が無かった現場は削除し、他の現場は変えない', () => {
        const edited = applyTargetNinku({ 1: { consumedNinku: 1, targetNinku: null } }, 2, 59);
        const restored = restoreNinkuEntry(edited, 2, undefined);
        expect(restored).toEqual({ 1: { consumedNinku: 1, targetNinku: null } });
    });
});

describe('createLatestGuard', () => {
    it('最後に始めた取得の応答だけを使う（逆順に届いた古い応答は捨てる）', () => {
        const guard = createLatestGuard();
        const first = guard.start();
        const second = guard.start();
        expect(guard.isLatest(second)).toBe(true);
        expect(guard.isLatest(first)).toBe(false);
    });

    it('invalidate すると取得中の応答はすべて古い扱いになる（保存前に読んだ集計で上書きしない）', () => {
        const guard = createLatestGuard();
        const inFlight = guard.start();
        guard.invalidate();
        expect(guard.isLatest(inFlight)).toBe(false);
        expect(guard.isLatest(guard.start())).toBe(true);
    });
});
