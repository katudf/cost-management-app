import { describe, it, expect } from 'vitest';
import * as xlsx from 'xlsx-js-style';
import { buildActualsMatrixReport, listMonths, formatPeriodLabel, OTHER_ROW_LABEL } from './actualsMatrixReport';
import { buildActualsMatrixWorkbook, actualsMatrixFileName, MONTH_TOTAL_LABEL, CUMULATIVE_LABEL, NINKU_NOTE } from './actualsMatrixExport';

const rec = (worker, date, hours) => ({ worker, date, hours });

describe('listMonths', () => {
    it('年またぎを昇順で並べ、開始と終了が逆でも入れ替える', () => {
        expect(listMonths('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
        expect(listMonths('2026-03', '2026-01')).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(formatPeriodLabel('2026-03', '2026-03')).toBe('2026年3月');
    });
});

describe('buildActualsMatrixReport', () => {
    const records = [
        rec('A', '2026-01-10', 7.5),   // 期間外（前）
        rec('A', '2026-03-02', 7.5),
        rec('A', '2026-03-02', 3.75),  // 同じ日は合算 → 11.25h = 1.5人工
        rec('A', '2026-04-01', 15),
        rec('B', '2026-03-03', 7.5),
        rec('C', '2026-01-05', 7.5),   // 期間外のみ
        rec('D', '2026-03-04', 0),     // 0時間は実績扱いしない
    ];
    const base = { records, orderedNames: ['B', 'A'], holidays: [], startMonth: '2026-03', endMonth: '2026-04' };
    const { months } = buildActualsMatrixReport(base);

    it('1か月＝1ページで、行は期間内に実績がある人だけを画面の順に並べる', () => {
        expect(months.map(m => m.monthKey)).toEqual(['2026-03', '2026-04']);
        expect(months[0].rows.map(r => r.name)).toEqual(['B', 'A']);
        expect(months[1].rows.map(r => r.name)).toEqual(['B', 'A']);
    });

    it('セルは人工、同日の複数日報は合算してから換算する', () => {
        const a = months[0].rows.find(r => r.name === 'A');
        expect(a.cells[1]).toBe(1.5);
        expect(a.cells[0]).toBeNull();
        expect(a.monthTotal).toBe(1.5);
    });

    it('累計は案件の最初の実績からその月末まで', () => {
        const a3 = months[0].rows.find(r => r.name === 'A');
        const a4 = months[1].rows.find(r => r.name === 'A');
        expect(a3.cumulative).toBe(2.5);   // 1月1.0 + 3月1.5
        expect(a4.cumulative).toBe(4.5);   // + 4月2.0
        expect(months[1].rows.find(r => r.name === 'B').monthTotal).toBeNull();
    });

    it('期間外のみ実績の人は「その他」行にまとめ、合計の累計が一致する', () => {
        expect(months[0].otherRow).toEqual({ name: OTHER_ROW_LABEL, cumulative: 1 });
        // 3月: A2.5 + B1.0 + その他1.0
        expect(months[0].total.cumulative).toBe(4.5);
        expect(months[0].total.monthTotal).toBe(2.5);
        expect(months[0].total.cells[1]).toBe(1.5);
        // 0時間のDは出ない
        expect(months[0].rows.some(r => r.name === 'D')).toBe(false);
    });

    it('単月でも累計は期間より前を含む', () => {
        const { months: one } = buildActualsMatrixReport({ ...base, startMonth: '2026-03', endMonth: '2026-03' });
        expect(one).toHaveLength(1);
        expect(one[0].rows.find(r => r.name === 'A').cumulative).toBe(2.5);
    });

    it('丸めは合算してから: 0.33人工×3日は月合計1.0', () => {
        const hours = 2.5; // 2.5/7.5 = 0.333…
        const recs = ['01', '02', '03'].map(d => rec('X', `2026-03-${d}`, hours));
        const { months: m } = buildActualsMatrixReport({ records: recs, startMonth: '2026-03', endMonth: '2026-03' });
        expect(m[0].rows[0].cells.slice(0, 3)).toEqual([0.3, 0.3, 0.3]);
        expect(m[0].rows[0].monthTotal).toBe(1);
    });

    it('合計行（縦方向）も丸める前に足す: 同じ日に2人×0.33人工は0.7', () => {
        const recs = [rec('X', '2026-03-02', 2.5), rec('Y', '2026-03-02', 2.5)];
        const { months: m } = buildActualsMatrixReport({ records: recs, startMonth: '2026-03', endMonth: '2026-03' });
        expect(m[0].rows.map(r => r.cells[1])).toEqual([0.3, 0.3]);
        expect(m[0].total.cells[1]).toBe(0.7);
    });
});

describe('Excel出力', () => {
    it('月ごとにシートができ、A4横の印刷設定が入る', () => {
        const bytes = buildActualsMatrixWorkbook({
            records: [rec('A', '2026-03-02', 7.5), rec('A', '2026-04-02', 7.5)],
            startMonth: '2026-03', endMonth: '2026-04', projectName: 'テスト現場', exportedAt: '2026-11-18',
        });
        const wb = xlsx.read(bytes, { type: 'array' });
        expect(wb.SheetNames).toEqual(['2026年3月', '2026年4月']);
        const ws = wb.Sheets['2026年4月'];
        const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
        const total = rows.find(r => r[0] === '合計');
        expect(total.at(-2)).toBe(1);  // 月合計
        expect(total.at(-1)).toBe(2);  // 累計
        // 画面（時間）と取り違えないよう、見出しと注記に単位（人工）が入る
        const header = rows.find(r => r[0] === '作業員名');
        expect(header.slice(-2)).toEqual([MONTH_TOTAL_LABEL, CUMULATIVE_LABEL]);
        expect(MONTH_TOTAL_LABEL).toContain('人工');
        expect(rows[2][0]).toContain(NINKU_NOTE);
        const zip = xlsx.CFB.read(bytes, { type: 'array' });
        const xml = new TextDecoder().decode(new Uint8Array(zip.FileIndex[zip.FullPaths.findIndex(p => p.endsWith('sheet2.xml'))].content));
        expect(xml).toContain('paperSize="9"');
    });

    it('ファイル名', () => {
        expect(actualsMatrixFileName('A 現場', '2026-05', '2026-03', 'xlsx')).toBe('実績入力_A_現場_2026-03_2026-05.xlsx');
    });
});
