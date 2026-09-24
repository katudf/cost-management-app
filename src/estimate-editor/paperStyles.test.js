import { describe, it, expect } from 'vitest';
import { fmt, fmtDate, calcFontSize } from './paperStyles';

describe('fmt', () => {
  // EstimatePDF.jsxに同じ関数がべた書きされていたための一本化（§9.22）。
  it('数値を3桁区切りにする', () => {
    expect(fmt(12345)).toBe('12,345');
  });

  it('null/undefined/空文字は空文字になる', () => {
    expect(fmt(null)).toBe('');
    expect(fmt(undefined)).toBe('');
    expect(fmt('')).toBe('');
  });

  it('0は"0"になる', () => {
    expect(fmt(0)).toBe('0');
  });
});

describe('fmtDate', () => {
  it('Y年M月D日形式にする', () => {
    expect(fmtDate('2026-09-24')).toBe('2026年9月24日');
  });

  it('falsyな値は空文字になる', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate('')).toBe('');
  });
});

describe('calcFontSize', () => {
  it('文字数がmaxChars以下ならbaseSizeのまま', () => {
    expect(calcFontSize('abc', 24, 10)).toBe(24);
  });

  it('textが空ならbaseSizeを返す', () => {
    expect(calcFontSize('', 24, 10)).toBe(24);
    expect(calcFontSize(null, 24, 10)).toBe(24);
  });

  it('maxCharsを超えると比率で縮小する', () => {
    // len=20, maxChars=10 -> ratio=0.5 -> baseSize*0.5 = 下限と同値
    expect(calcFontSize('a'.repeat(20), 24, 10)).toBe(12);
  });

  it('縮小してもbaseSizeの50%を下回らない', () => {
    // len=100, maxChars=10 -> ratio=0.1 -> baseSize*0.1 だが下限0.5でクランプ
    expect(calcFontSize('a'.repeat(100), 24, 10)).toBe(12);
  });
});
