import { describe, it, expect } from 'vitest';
import { formatProfitLoss } from './projectUtils';

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

  it('非数値/nullは0として扱う', () => {
    expect(formatProfitLoss(null)).toBe('+¥0');
    expect(formatProfitLoss(undefined)).toBe('+¥0');
    expect(formatProfitLoss('abc')).toBe('+¥0');
  });
});
