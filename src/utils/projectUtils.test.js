import { describe, it, expect } from 'vitest';
import { formatProfitLoss, calculateProjectsSummary } from './projectUtils';

describe('formatProfitLoss', () => {
  // ProjectCompactView/ProjectListViewに同じフォーマット関数がべた書きされていたための一本化（§9.21）。
  it('正の値には+と¥を付けて3桁区切りにする', () => {
    expect(formatProfitLoss(12345)).toBe('+¥12,345');
  });

  it('負の値には-を付け、絶対値を表示する', () => {
    expect(formatProfitLoss(-6789)).toBe('-¥6,789');
  });

  it('0は+¥0になる', () => {
    expect(formatProfitLoss(0)).toBe('+¥0');
  });

  it('小数は四捨五入する', () => {
    expect(formatProfitLoss(1234.6)).toBe('+¥1,235');
    expect(formatProfitLoss(-1234.6)).toBe('-¥1,235');
  });

  it('null/undefined は「未集計」（明細を読み込んでいない現場）', () => {
    expect(formatProfitLoss(null)).toBe('未集計');
    expect(formatProfitLoss(undefined)).toBe('未集計');
  });

  it('非数値は0として扱う', () => {
    expect(formatProfitLoss('abc')).toBe('+¥0');
  });
});

describe('calculateProjectsSummary', () => {
  it('明細を読み込んでいない現場（_isLoaded: false）は予測損益を null にする', () => {
    const [p] = calculateProjectsSummary([{ id: 1, status: '完了', masterData: [], records: [], progressData: {}, subcontractors: [], _isLoaded: false }], 3000);
    expect(p.predictedProfitLoss).toBeNull();
  });

  it('読み込み済みの現場は数値で返す', () => {
    const [p] = calculateProjectsSummary([{
      id: 1, status: '施工中', _isLoaded: true, subcontractors: [],
      masterData: [{ id: 10, target: 10 }], records: [{ taskId: 10, hours: 5 }], progressData: { 10: 50 },
    }], 1000);
    expect(p.predictedProfitLoss).toBe(0);
  });
});
