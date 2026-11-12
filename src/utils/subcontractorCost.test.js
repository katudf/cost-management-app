import { describe, it, expect } from 'vitest';
import { classifySubcontractorRecords, calcSubcontractorCost, countReclassifiedRecords, summarizeTaskCosts } from './projectUtils';

// DB 側（scripts/test-subcontractors-db.py の「請負契約」「職長向けの協力業者費合計」）と同じデータ・同じ期待値。
// 判定の規則（両端を含む／終了日 NULL は継続中／未紐づけは常用）がズレないことを固定する（パリティテスト）。
const ukeoi = (over = {}) => ({
    type: '請負', project_id: 1, subcontractor_id: 1, contract_amount: 500000,
    start_date: '2026-11-10', end_date: '2026-11-12', ...over,
});
const rec = (date, over = {}) => ({ project_id: 1, subcontractor_id: 1, date, worker_count: 1, unit_price: 25000, ...over });

describe('classifySubcontractorRecords', () => {
    const contracts = [ukeoi()];

    it('請負期間の開始日・終了日の両日を含む', () => {
        const { ukeoi: u, joyo } = classifySubcontractorRecords(
            [rec('2026-11-09'), rec('2026-11-10'), rec('2026-11-12'), rec('2026-11-13')], contracts);
        expect(u.map(r => r.date)).toEqual(['2026-11-10', '2026-11-12']);
        expect(joyo.map(r => r.date)).toEqual(['2026-11-09', '2026-11-13']);
    });

    it('終了日が NULL の請負は継続中として、以降の記録をすべて請負にする', () => {
        const open = [ukeoi({ end_date: null })];
        const { ukeoi: u, joyo } = classifySubcontractorRecords([rec('2026-11-09'), rec('2027-01-01')], open);
        expect(u.map(r => r.date)).toEqual(['2027-01-01']);
        expect(joyo.map(r => r.date)).toEqual(['2026-11-09']);
    });

    it('1日だけの請負（開始日 = 終了日）も判定できる', () => {
        const oneDay = [ukeoi({ start_date: '2026-11-13', end_date: '2026-11-13' })];
        const { ukeoi: u } = classifySubcontractorRecords([rec('2026-11-12'), rec('2026-11-13'), rec('2026-11-14')], oneDay);
        expect(u.map(r => r.date)).toEqual(['2026-11-13']);
    });

    it('隣り合う請負（11/10〜11/12 と 11/13〜11/13）は、境目の日もそれぞれ請負になる', () => {
        const adjacent = [ukeoi(), ukeoi({ start_date: '2026-11-13', end_date: '2026-11-13', contract_amount: 100000 })];
        const { ukeoi: u, joyo } = classifySubcontractorRecords(
            [rec('2026-11-12'), rec('2026-11-13'), rec('2026-11-14')], adjacent);
        expect(u.map(r => r.date)).toEqual(['2026-11-12', '2026-11-13']);
        expect(joyo.map(r => r.date)).toEqual(['2026-11-14']);
    });

    it('別の会社・別の現場の請負期間には影響されない', () => {
        const { joyo } = classifySubcontractorRecords(
            [rec('2026-11-11', { subcontractor_id: 2 }), rec('2026-11-11', { project_id: 2 })], contracts);
        expect(joyo).toHaveLength(2);
    });

    it('会社に未紐づけ（subcontractor_id が NULL）の旧記録は常用になる', () => {
        const { joyo, ukeoi: u } = classifySubcontractorRecords([rec('2026-11-11', { subcontractor_id: null })], contracts);
        expect(joyo).toHaveLength(1);
        expect(u).toHaveLength(0);
    });

    it('常用契約や開始日のない請負は振り分けに使わない', () => {
        const { ukeoi: u } = classifySubcontractorRecords(
            [rec('2026-11-11')], [{ type: '常用', subcontractor_id: 1, project_id: 1 }, ukeoi({ start_date: null })]);
        expect(u).toHaveLength(0);
    });

    it('同じ日・同じ会社に複数の記録があっても、記録ごとに判定する', () => {
        const { ukeoi: u } = classifySubcontractorRecords([rec('2026-11-11'), rec('2026-11-11', { worker_count: 2 })], contracts);
        expect(u).toHaveLength(2);
    });

    it('契約が空・未指定なら、すべて常用', () => {
        expect(classifySubcontractorRecords([rec('2026-11-11')], undefined).joyo).toHaveLength(1);
        expect(classifySubcontractorRecords(undefined, undefined)).toEqual({ joyo: [], ukeoi: [] });
    });
});

describe('calcSubcontractorCost', () => {
    // scripts/test-subcontractors-db.py の現場1と同じ構成
    const records = [
        rec('2026-11-02', { worker_count: 3, unit_price: 25000 }),
        rec('2026-11-03', { subcontractor_id: 2, worker_count: 2, unit_price: 0 }),
        rec('2026-11-04', { subcontractor_id: null, worker_count: 1, unit_price: 0 }),
        rec('2026-11-05', { worker_count: 1, unit_price: 30000 }),
        rec('2026-11-11', { worker_count: 4, unit_price: 0 }),
        rec('2026-11-14', { worker_count: 2, unit_price: 25000 }),
    ];
    const contracts = [
        { type: '常用', project_id: 1, subcontractor_id: 1, unit_price: 25000 },
        ukeoi(),
        ukeoi({ start_date: '2026-11-13', end_date: '2026-11-13', contract_amount: 100000 }),
    ];

    it('常用（請負期間外）の人数×単価 + 請負の契約金額（DB の get_project_subcontract_cost と同じ 855000）', () => {
        expect(calcSubcontractorCost(records, contracts)).toBe(75000 + 30000 + 50000 + 600000);
    });

    it('契約を渡さなければ、従来どおり全記録を人数×単価で計上する', () => {
        expect(calcSubcontractorCost([{ worker_count: 2, unit_price: 10000 }, { worker_count: '1', unit_price: '5000' }])).toBe(25000);
        expect(calcSubcontractorCost(undefined)).toBe(0);
        expect(calcSubcontractorCost([{ worker_count: 3 }])).toBe(0);
    });

    it('請負契約だけで記録がなくても、契約金額は計上される', () => {
        expect(calcSubcontractorCost([], [ukeoi()])).toBe(500000);
    });

    it('契約金額が未入力の請負は 0 として扱う', () => {
        expect(calcSubcontractorCost([], [ukeoi({ contract_amount: null })])).toBe(0);
    });
});

describe('countReclassifiedRecords', () => {
    const records = [rec('2026-11-09', { id: 'a' }), rec('2026-11-11', { id: 'b' }), rec('2026-11-13', { id: 'c' })];

    it('請負契約を削除すると、期間内の記録が常用に戻る', () => {
        expect(countReclassifiedRecords(records, [ukeoi()], [])).toBe(1);
    });

    it('期間を延ばすと、増えた分の記録だけが請負になる', () => {
        expect(countReclassifiedRecords(records, [ukeoi()], [ukeoi({ end_date: '2026-11-13' })])).toBe(1);
    });

    it('変更の前後で扱いが変わらなければ 0 件', () => {
        expect(countReclassifiedRecords(records, [ukeoi()], [ukeoi({ contract_amount: 1 })])).toBe(0);
    });
});

describe('summarizeTaskCosts', () => {
    it('予測損益は、常用・請負をあわせた協力業者原価を差し引いた値になる', () => {
        const items = [{ target: 100, actual: 50, progress: 50 }]; // 予測損益 0
        const summary = summarizeTaskCosts(items, 3000, [rec('2026-11-02', { worker_count: 2, unit_price: 20000 })], [ukeoi()]);
        expect(summary.subcontractorCost).toBe(40000 + 500000);
        expect(summary.predictedProfitLoss).toBe(-540000);
    });

    it('契約を渡さない従来の呼び出しは結果が変わらない', () => {
        const summary = summarizeTaskCosts([{ target: 100, actual: 50, progress: 50 }], 3000, [{ worker_count: 1, unit_price: 10000 }]);
        expect(summary.subcontractorCost).toBe(10000);
    });
});
