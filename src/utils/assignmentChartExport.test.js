import { describe, it, expect } from 'vitest';
import * as xlsx from 'xlsx-js-style';
import { buildAssignmentChartSheet } from './assignmentChartExport';
import { buildDateColumns } from './dateUtils';

// 2026-11-06(金) 〜 11-09(月) の4日。列2=金, 列3=土, 列4=日, 列5=月
const cols = buildDateColumns(new Date('2026-11-06T00:00:00'), 4);
const projects = [
    { id: 1, name: '現場A', color: '#FF0000' },
    { id: 2, name: '現場B', color: '#00FF00' }
];
const projectMap = { 1: { name: '現場A', color: '#FF0000' }, 2: { name: '現場B', color: '#00FF00' } };
// 現場Aは 11/7〜11/8 の2日間、現場Bはバーなし
const spanFn = (p) => (p.id === 1 ? { startIdx: 1, endIdx: 2, span: 2 } : null);
const workers = [{ id: 10, name: '山田' }, { id: 11, name: '佐藤' }];
const lookup = {
    '10_2026-11-09': [{ projectId: 1 }],
    '11_2026-11-06': [{ projectId: 1 }, { projectId: 2 }]
};

const cell = (ws, r, c) => ws[xlsx.utils.encode_cell({ r, c })];
const build = (labels) => buildAssignmentChartSheet(workers, cols, lookup, projectMap, projects, '期間', spanFn, labels);

describe('buildAssignmentChartSheet', () => {
    const ws = build({ 1: '12.5/400' });
    // 行: 0タイトル / 1空 / 2見出し / 3現場A / 4現場B / 5作業員見出し / 6山田 / 7-8佐藤（2現場で2行）
    it('現場名の右に人工列を入れ、日付は3列目から並べる', () => {
        expect(cell(ws, 2, 0).v).toBe('現場名');
        expect(cell(ws, 2, 1).v).toBe('人工');
        expect(cell(ws, 2, 2).v).toBe('11/6(金)');
        expect(cell(ws, 2, 5).v).toBe('11/9(月)');
    });

    it('人工列の見出しに基準日を書ける', () => {
        const withHeader = buildAssignmentChartSheet(workers, cols, lookup, projectMap, projects, '期間', spanFn, {}, '人工（11/9時点）');
        expect(cell(withHeader, 2, 1).v).toBe('人工（11/9時点）');
    });

    it('人工列に表示文字列を載せ、無い現場は空欄にする', () => {
        expect(cell(ws, 3, 1).v).toBe('12.5/400');
        expect(cell(ws, 4, 1).v).toBe('');
    });

    it('バーは日付の列（1列ずれた位置）に塗る', () => {
        expect(cell(ws, 3, 2).v).toBe('');
        expect(cell(ws, 3, 3).v).toBe('■');
        expect(cell(ws, 3, 4).v).toBe('■');
        expect(cell(ws, 3, 3).s.fill.fgColor.rgb).toBe('FF0000');
        expect(cell(ws, 3, 1).s.fill).toBeUndefined();
    });

    it('見出しの土日の色は日付の列に合わせる', () => {
        expect(cell(ws, 2, 3).s.fill.fgColor.rgb).toBe('DBEAFE'); // 土
        expect(cell(ws, 2, 4).s.fill.fgColor.rgb).toBe('FEE2E2'); // 日
        expect(cell(ws, 2, 1).s.fill.fgColor.rgb).toBe('334155'); // 人工列の見出し
    });

    it('作業員の配置は正しい日付の列に入り、空きの土日も正しい列を塗る', () => {
        expect(cell(ws, 6, 0).v).toBe('山田');
        expect(cell(ws, 6, 5).v).toBe('現場A');
        expect(cell(ws, 6, 5).s.fill.fgColor.rgb).toBe('FF0000');
        expect(cell(ws, 6, 3).s.fill.fgColor.rgb).toBe('DBEAFE'); // 土の空きセル
        expect(cell(ws, 6, 4).s.fill.fgColor.rgb).toBe('FEE2E2'); // 日の空きセル
        expect(cell(ws, 7, 2).v).toBe('現場A');
        expect(cell(ws, 8, 2).v).toBe('現場B');
    });

    it('作業員名は人工列まで横に結合し、複数行の作業員は縦にも結合する', () => {
        const merges = ws['!merges'];
        expect(merges).toContainEqual({ s: { r: 5, c: 0 }, e: { r: 5, c: 1 } });
        expect(merges).toContainEqual({ s: { r: 6, c: 0 }, e: { r: 6, c: 1 } });
        expect(merges).toContainEqual({ s: { r: 7, c: 0 }, e: { r: 8, c: 1 } });
    });

    it('人工の表示文字列を渡さなくても出力できる（人工列は空欄）', () => {
        const ws2 = buildAssignmentChartSheet(workers, cols, lookup, projectMap, projects, '期間', spanFn);
        expect(cell(ws2, 3, 1).v).toBe('');
    });
});
