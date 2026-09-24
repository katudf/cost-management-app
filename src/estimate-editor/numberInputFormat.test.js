import { describe, it, expect } from 'vitest';
import { formatNumberInput, formatQuantityInput, parseNumberInput } from './numberInputFormat';

// EstimateItemTable.jsx と SheetPaper.jsx に重複していた数値入力欄の
// フォーマット/パースヘルパの一本化（§9.26）。

describe('formatNumberInput', () => {
  it('カンマ区切りにフォーマットする', () => {
    expect(formatNumberInput(1234)).toBe('1,234');
  });

  it('負数は▲表記にする', () => {
    expect(formatNumberInput(-1234)).toBe('▲1,234');
  });

  it('null/undefined/空文字には空文字を返す', () => {
    expect(formatNumberInput(null)).toBe('');
    expect(formatNumberInput(undefined)).toBe('');
    expect(formatNumberInput('')).toBe('');
  });

  it('数値でない値には空文字を返す', () => {
    expect(formatNumberInput('abc')).toBe('');
  });
});

describe('formatQuantityInput', () => {
  it('小数点以下1桁で表示する', () => {
    expect(formatQuantityInput(5)).toBe('5.0');
  });

  it('負数は▲表記にする', () => {
    expect(formatQuantityInput(-2.5)).toBe('▲2.5');
  });

  it('null/undefined/空文字には空文字を返す', () => {
    expect(formatQuantityInput(null)).toBe('');
    expect(formatQuantityInput(undefined)).toBe('');
    expect(formatQuantityInput('')).toBe('');
  });
});

describe('parseNumberInput', () => {
  it('カンマを除去して数値文字列に戻す', () => {
    expect(parseNumberInput('1,234')).toBe('1234');
  });

  it('先頭の▲を負符号として扱う', () => {
    expect(parseNumberInput('▲1,234')).toBe('-1234');
  });

  it('全角数字・全角ピリオドを半角に変換する', () => {
    expect(parseNumberInput('１２．５')).toBe('12.5');
  });

  it('先頭以外の▲や－はカンマ除去のみで保持する', () => {
    expect(parseNumberInput('12▲34')).toBe('12▲34');
  });

  it('末尾の小数点は入力途中として許容する', () => {
    expect(parseNumberInput('12.')).toBe('12.');
  });
});
