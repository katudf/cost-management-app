import { describe, it, expect } from 'vitest';
import {
    draftKey,
    draftKeyOf,
    isSameDraftTarget,
    upsertIntoQueue,
    removeFromQueue,
    selectNotifiableDrafts,
    type DraftLike,
} from './draftQueueUtils';

const d = (projectId: string | number, date: string, extra: Partial<DraftLike> = {}): DraftLike => ({
    selectedProjectId: projectId,
    selectedDate: date,
    ...extra,
});

describe('draftKey', () => {
    it('現場idと日付を連結する', () => {
        expect(draftKey(12, '2026-09-17')).toBe('12__2026-09-17');
    });

    it('数値idと文字列idが同じキーになる（localStorage往復で型が変わるため）', () => {
        expect(draftKey(12, '2026-09-17')).toBe(draftKey('12', '2026-09-17'));
    });

    it('日付が違えば別のキーになる', () => {
        expect(draftKey(12, '2026-09-17')).not.toBe(draftKey(12, '2026-09-18'));
    });

    it('現場が違えば別のキーになる', () => {
        expect(draftKey(12, '2026-09-17')).not.toBe(draftKey(13, '2026-09-17'));
    });

    it('null / undefined でも例外にならない', () => {
        expect(draftKey(null, null)).toBe('null__null');
        expect(draftKey(undefined, undefined)).toBe('undefined__undefined');
    });

    // ⚠️ 既知の制約。区切りを2文字にしても境界の曖昧さは消えない:
    //    '1_' + '__' + '2026-09-17' と '1' + '__' + '_2026-09-17' は同じ文字列になる。
    // 実運用では id は数値、日付は 'YYYY-MM-DD' 固定なので衝突しないが、
    // 「衝突しない」と誤解しないようにテストで明示しておく。
    it('id や日付に区切り文字が混ざるとキーは衝突しうる（既知の制約）', () => {
        expect(draftKey('1_', '2026-09-17')).toBe(draftKey('1', '_2026-09-17'));
    });
});

describe('draftKeyOf', () => {
    it('下書きからキーを作る', () => {
        expect(draftKeyOf(d(7, '2026-01-05'))).toBe('7__2026-01-05');
    });

    it('余計なプロパティはキーに影響しない', () => {
        expect(draftKeyOf(d(7, '2026-01-05', { tasks: [1, 2, 3], isAutoSaved: true })))
            .toBe(draftKeyOf(d(7, '2026-01-05')));
    });
});

describe('isSameDraftTarget', () => {
    it('現場と日付が一致すれば true', () => {
        expect(isSameDraftTarget(d(5, '2026-03-01'), 5, '2026-03-01')).toBe(true);
    });

    it('型が違っても一致とみなす', () => {
        expect(isSameDraftTarget(d('5', '2026-03-01'), 5, '2026-03-01')).toBe(true);
    });

    it('日付が違えば false', () => {
        expect(isSameDraftTarget(d(5, '2026-03-01'), 5, '2026-03-02')).toBe(false);
    });

    it('現場が違えば false', () => {
        expect(isSameDraftTarget(d(5, '2026-03-01'), 6, '2026-03-01')).toBe(false);
    });
});

describe('upsertIntoQueue', () => {
    it('空のキューに追加できる', () => {
        expect(upsertIntoQueue([], d(1, '2026-01-01'))).toEqual([d(1, '2026-01-01')]);
    });

    it('別の 現場+日付 は上書きせずに追加する', () => {
        const queue = [d(1, '2026-01-01')];
        const next = upsertIntoQueue(queue, d(2, '2026-01-01'));
        expect(next).toHaveLength(2);
    });

    it('同じ 現場+日付 は上書きする', () => {
        const queue = [d(1, '2026-01-01', { tasks: ['old'] })];
        const next = upsertIntoQueue(queue, d(1, '2026-01-01', { tasks: ['new'] }));
        expect(next).toHaveLength(1);
        expect(next[0].tasks).toEqual(['new']);
    });

    it('id の型が違っても同一とみなして上書きする', () => {
        const queue = [d('1', '2026-01-01', { tasks: ['old'] })];
        const next = upsertIntoQueue(queue, d(1, '2026-01-01', { tasks: ['new'] }));
        expect(next).toHaveLength(1);
        expect(next[0].tasks).toEqual(['new']);
    });

    it('上書きしても位置は変わらない（通知の並びが飛ばないように）', () => {
        const queue = [d(1, '2026-01-01'), d(2, '2026-01-01'), d(3, '2026-01-01')];
        const next = upsertIntoQueue(queue, d(2, '2026-01-01', { tasks: ['new'] }));
        expect(next.map(x => x.selectedProjectId)).toEqual([1, 2, 3]);
        expect(next[1].tasks).toEqual(['new']);
    });

    it('元の配列を破壊しない', () => {
        const queue = [d(1, '2026-01-01', { tasks: ['old'] })];
        upsertIntoQueue(queue, d(1, '2026-01-01', { tasks: ['new'] }));
        expect(queue[0].tasks).toEqual(['old']);
    });

    it('キューが null/undefined でも落ちない', () => {
        expect(upsertIntoQueue(null as unknown as DraftLike[], d(1, '2026-01-01'))).toHaveLength(1);
        expect(upsertIntoQueue(undefined as unknown as DraftLike[], d(1, '2026-01-01'))).toHaveLength(1);
    });
});

describe('removeFromQueue', () => {
    it('指定した 現場+日付 だけを取り除く', () => {
        const queue = [d(1, '2026-01-01'), d(2, '2026-01-01'), d(1, '2026-01-02')];
        const next = removeFromQueue(queue, 1, '2026-01-01');
        expect(next).toHaveLength(2);
        expect(next.some(x => draftKeyOf(x) === '1__2026-01-01')).toBe(false);
    });

    it('id の型が違っても取り除ける', () => {
        const queue = [d('1', '2026-01-01')];
        expect(removeFromQueue(queue, 1, '2026-01-01')).toHaveLength(0);
    });

    it('該当が無ければそのまま', () => {
        const queue = [d(1, '2026-01-01')];
        expect(removeFromQueue(queue, 9, '2026-01-01')).toHaveLength(1);
    });

    it('元の配列を破壊しない', () => {
        const queue = [d(1, '2026-01-01')];
        removeFromQueue(queue, 1, '2026-01-01');
        expect(queue).toHaveLength(1);
    });

    it('キューが null/undefined でも空配列を返す', () => {
        expect(removeFromQueue(null as unknown as DraftLike[], 1, '2026-01-01')).toEqual([]);
        expect(removeFromQueue(undefined as unknown as DraftLike[], 1, '2026-01-01')).toEqual([]);
    });
});

describe('selectNotifiableDrafts', () => {
    it('編集中の 現場+日付 の自動保存は通知しない', () => {
        const queue = [d(1, '2026-01-01', { isAutoSaved: true })];
        expect(selectNotifiableDrafts(queue, 1, '2026-01-01')).toEqual([]);
    });

    it('編集中の 現場+日付 でも通信エラー退避なら通知する', () => {
        const queue = [d(1, '2026-01-01')];
        expect(selectNotifiableDrafts(queue, 1, '2026-01-01')).toHaveLength(1);
    });

    it('他の現場の自動保存は通知する', () => {
        const queue = [d(2, '2026-01-01', { isAutoSaved: true })];
        expect(selectNotifiableDrafts(queue, 1, '2026-01-01')).toHaveLength(1);
    });

    it('同じ現場でも他の日付の自動保存は通知する', () => {
        const queue = [d(1, '2026-01-02', { isAutoSaved: true })];
        expect(selectNotifiableDrafts(queue, 1, '2026-01-01')).toHaveLength(1);
    });

    it('id の型が違っても編集中と判定する（localStorage往復後の退行防止）', () => {
        const queue = [d('1', '2026-01-01', { isAutoSaved: true })];
        expect(selectNotifiableDrafts(queue, 1, '2026-01-01')).toEqual([]);
    });

    it('現場未選択ならすべて通知対象', () => {
        const queue = [d(1, '2026-01-01'), d(2, '2026-01-02', { isAutoSaved: true })];
        expect(selectNotifiableDrafts(queue, null, null)).toHaveLength(2);
    });

    it('元の配列を破壊しない', () => {
        const queue = [d(1, '2026-01-01', { isAutoSaved: true })];
        selectNotifiableDrafts(queue, 1, '2026-01-01');
        expect(queue).toHaveLength(1);
    });

    it('キューが null/undefined でも空配列を返す', () => {
        expect(selectNotifiableDrafts(null as unknown as DraftLike[], 1, '2026-01-01')).toEqual([]);
        expect(selectNotifiableDrafts(undefined as unknown as DraftLike[], 1, '2026-01-01')).toEqual([]);
    });

    it('混在キューから正しい組だけ残す', () => {
        const queue = [
            d(1, '2026-01-01', { isAutoSaved: true }),   // 編集中の自動保存 → 除外
            d(1, '2026-01-01', { isAutoSaved: false }),  // 編集中だが退避 → 残す
            d(1, '2026-01-02', { isAutoSaved: true }),   // 別日付 → 残す
            d(2, '2026-01-01', { isAutoSaved: true }),   // 別現場 → 残す
        ];
        expect(selectNotifiableDrafts(queue, 1, '2026-01-01')).toHaveLength(3);
    });
});
