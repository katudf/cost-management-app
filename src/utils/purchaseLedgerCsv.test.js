import { describe, it, expect } from 'vitest';
import { buildCsvColMap, parseCsv, normalizeCsvDate, parseNumericCell } from './purchaseLedgerCsv';

// PurchaseLedgerTab.jsxにべた書きされていたCSVインポート用の純関数群の一本化（§9.24）。

describe('buildCsvColMap', () => {
  it('各列見出しから対応するインデックスを解決する', () => {
    const headers = ['月/日', '工事名', '購入先', '名称', '備考', '数量', '単位', '単価', '金額'];
    expect(buildCsvColMap(headers)).toEqual({
      date: 0,
      project_name: 1,
      supplier: 2,
      item_name: 3,
      note: 4,
      quantity: 5,
      unit: 6,
      unit_price: 7,
      amount: 8
    });
  });

  it('日付は「日付」見出しでもフォールバックする', () => {
    const headers = ['日付', '工事名'];
    expect(buildCsvColMap(headers).date).toBe(0);
  });

  it('仕入先見出しでも購入先として解決する', () => {
    const headers = ['月/日', '仕入先'];
    expect(buildCsvColMap(headers).supplier).toBe(1);
  });

  it('品名見出しでも名称として解決する', () => {
    const headers = ['月/日', '品名'];
    expect(buildCsvColMap(headers).item_name).toBe(1);
  });

  it('単位は単価と誤認しない（「単価」列は単位として拾わない）', () => {
    const headers = ['単価', '単位'];
    expect(buildCsvColMap(headers).unit).toBe(1);
    expect(buildCsvColMap(headers).unit_price).toBe(0);
  });

  it('見出しが存在しない列は-1になる', () => {
    expect(buildCsvColMap(['工事名']).date).toBe(-1);
  });
});

describe('parseCsv', () => {
  it('単純なCSVを行×列の配列にパースする', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('末尾に改行がなくても最終行を取り込む', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('ダブルクォートで囲まれたフィールド内のカンマを区切りとして扱わない', () => {
    expect(parseCsv('"a,b",c\n')).toEqual([['a,b', 'c']]);
  });

  it('ダブルクォート内の改行をフィールドの一部として扱う', () => {
    expect(parseCsv('"a\nb",c\n')).toEqual([['a\nb', 'c']]);
  });

  it('""はエスケープされた1つのダブルクォートとして扱う', () => {
    expect(parseCsv('"a""b",c\n')).toEqual([['a"b', 'c']]);
  });

  it('CRLF改行を1つの改行として扱う', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('先頭のBOMを除去する', () => {
    expect(parseCsv('﻿a,b\n')).toEqual([['a', 'b']]);
  });
});

describe('normalizeCsvDate', () => {
  it('null/undefined/空文字はnullを返す', () => {
    expect(normalizeCsvDate(null)).toBeNull();
    expect(normalizeCsvDate(undefined)).toBeNull();
    expect(normalizeCsvDate('')).toBeNull();
    expect(normalizeCsvDate('  ')).toBeNull();
  });

  it('Excelシリアル値をISO日付に変換する', () => {
    // 45383 = 2024-04-01 (Excelの1900日付システム)
    expect(normalizeCsvDate('45383')).toBe('2024-04-01');
  });

  it('YYYY/MM/DD形式を正規化する', () => {
    expect(normalizeCsvDate('2026/4/1')).toBe('2026-04-01');
  });

  it('YYYY-MM-DD形式を正規化する', () => {
    expect(normalizeCsvDate('2026-04-01')).toBe('2026-04-01');
  });

  it('年月日を含む和暦風の区切りを正規化する', () => {
    expect(normalizeCsvDate('2026年4月1日')).toBe('2026-04-01');
  });

  it('不正な日付文字列はnullを返す', () => {
    expect(normalizeCsvDate('not-a-date')).toBeNull();
  });
});

describe('parseNumericCell', () => {
  it('null/undefined/空文字はnullを返す', () => {
    expect(parseNumericCell(null)).toBeNull();
    expect(parseNumericCell(undefined)).toBeNull();
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('  ')).toBeNull();
  });

  it('カンマ区切りの数値を変換する', () => {
    expect(parseNumericCell('1,500')).toBe(1500);
  });

  it('円記号や空白を除去して変換する', () => {
    expect(parseNumericCell('¥ 1,500 ')).toBe(1500);
  });

  it('数値そのままでも変換する', () => {
    expect(parseNumericCell(1500)).toBe(1500);
  });

  it('数値変換できない文字列はnullを返す', () => {
    expect(parseNumericCell('abc')).toBeNull();
  });
});
