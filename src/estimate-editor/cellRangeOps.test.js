import { describe, it, expect } from 'vitest';
import { ITEM_TYPE } from '../utils/constants';
import {
  rangeColOf,
  resolveRange,
  rangeCellKeys,
  clearRange,
  pasteIntoRange,
  rangeToTsv,
  stepRangeRow,
  writableColsOf,
} from './cellRangeOps';

const item = (uid, extra = {}) => ({
  _uid: uid, sheet_id: 'A', item_type: ITEM_TYPE.ITEM,
  name: uid, spec: '', quantity: 1, unit: '式', unit_price: 100, amount: 100, note: '', ...extra,
});
const base = () => [
  item('r1'),
  { _uid: 'c1', sheet_id: 'A', item_type: ITEM_TYPE.CATEGORY, category_symbol: 'A', name: '塗装工事' },
  item('r2', { quantity: 2, unit_price: 50, amount: 100 }),
  item('r3', { linked_sheet_id: 'B', unit_price: 900, amount: 900 }),
  { _uid: 'm1', sheet_id: 'A', item_type: ITEM_TYPE.COMMENT, name: '※注記' },
  item('b1', { sheet_id: 'B' }),
];
const range = (a, ac, f, fc) => ({ sheetId: 'A', anchor: { uid: a, col: ac }, focus: { uid: f, col: fc } });
const byUid = (items, uid) => items.find(i => i._uid === uid);

describe('cellRangeOps 範囲', () => {
  it('入力欄の列名を範囲の列名へ読み替える', () => {
    expect(rangeColOf('__amount')).toBe('amount');
    expect(rangeColOf('category_symbol')).toBe('name');
    expect(rangeColOf('unit')).toBe('unit');
    expect(rangeColOf('foo')).toBeNull();
  });

  it('逆向きに選んでも表示順の行・列になり、1セルだけなら範囲なし', () => {
    const r = resolveRange(base(), range('r2', 'unit_price', 'r1', 'quantity'));
    expect(r.rows.map(x => x._uid)).toEqual(['r1', 'c1', 'r2']);
    expect(r.cols).toEqual(['quantity', 'unit', 'unit_price']);
    expect(resolveRange(base(), range('r1', 'name', 'r1', 'name'))).toBeNull();
    expect(resolveRange(base(), range('r1', 'name', 'b1', 'name'))).toBeNull(); // 別シートの行は含めない
  });

  it('rangeCellKeys は強調表示用に全セルのキーを返す', () => {
    const keys = rangeCellKeys(base(), range('r1', 'unit', 'c1', 'unit_price'));
    expect([...keys].sort()).toEqual(['c1:unit', 'c1:unit_price', 'r1:unit', 'r1:unit_price']);
  });

  it('Shift+↑↓ の移動先はシート内で止まる', () => {
    expect(stepRangeRow(base(), 'A', 'r1', -1)).toBe('r1');
    expect(stepRangeRow(base(), 'A', 'r1', 1)).toBe('c1');
    expect(stepRangeRow(base(), 'A', 'm1', 1)).toBe('m1');
  });

  it('リンク行は制御される列に書き込めない', () => {
    expect(writableColsOf(byUid(base(), 'r3'))).toEqual(['name', 'spec', 'quantity', 'unit']);
    expect(writableColsOf({ item_type: ITEM_TYPE.ITEM, linked_category_item_id: 'x' })).toEqual(['spec', 'note']);
  });
});

describe('cellRangeOps 消去', () => {
  it('範囲を空にし、書き込めないセルは飛ばして数える（行は消さない）', () => {
    const res = clearRange(base(), range('r1', 'unit', 'r3', 'unit_price'));
    expect(res.items).toHaveLength(6);
    expect(byUid(res.items, 'r1')).toMatchObject({ unit: '', unit_price: '', amount: 100 });
    expect(byUid(res.items, 'r3')).toMatchObject({ unit: '', unit_price: 900 });
    // 工種行の単位・単価（2）＋リンク行の単価（1）
    expect(res.skipped).toBe(3);
    expect(res.changed).toBe(5);
  });
});

describe('cellRangeOps 貼り付け', () => {
  it('1セルの値は範囲全体へ入れ、数量・単価なら金額を再計算する', () => {
    const res = pasteIntoRange(base(), range('r1', 'quantity', 'r2', 'quantity'), '3');
    expect(byUid(res.items, 'r1')).toMatchObject({ quantity: 3, amount: 300 });
    expect(byUid(res.items, 'r2')).toMatchObject({ quantity: 3, amount: 150 });
    expect(res.skipped).toBe(1); // 工種行
    expect(res.truncated).toBe(0);
  });

  it('文字の1セルを下へ（単位）', () => {
    const res = pasteIntoRange(base(), range('r1', 'unit', 'r3', 'unit'), '㎡');
    expect(['r1', 'r2', 'r3'].map(u => byUid(res.items, u).unit)).toEqual(['㎡', '㎡', '㎡']);
  });

  it('複数セルは左上から範囲の中だけに入れ、はみ出しを数える（行は挿入しない）', () => {
    const res = pasteIntoRange(base(), range('r1', 'spec', 'c1', 'quantity'), 'a\t1\tx\nb\t2\ty\nc\t3\tz');
    expect(byUid(res.items, 'r1')).toMatchObject({ spec: 'a', quantity: 1 });
    expect(res.items).toHaveLength(6);
    expect(res.truncated).toBe(5); // 列はみ出し3（x,y,z）＋3行目の2セル
    expect(res.skipped).toBe(2);   // 工種行の仕様・数量
  });

  it('範囲がコピー元より大きくても繰り返さない', () => {
    const res = pasteIntoRange(base(), range('r1', 'note', 'r2', 'note'), 'x\t');
    // "x\t" は1行2セル → 範囲は1列なので2セル目ははみ出し、2行目は触らない
    expect(byUid(res.items, 'r1').note).toBe('x');
    expect(byUid(res.items, 'r2').note).toBe('');
    expect(res.truncated).toBe(1);
  });

  it('金額列への指定は数量・単価の再計算より優先する', () => {
    const res = pasteIntoRange(base(), range('r1', 'quantity', 'r1', 'amount'), '2\t式\t10\t999');
    expect(byUid(res.items, 'r1')).toMatchObject({ quantity: 2, unit_price: 10, amount: 999 });
  });

  it('カンマ付きの数値は数値にする', () => {
    const res = pasteIntoRange(base(), range('r1', 'unit_price', 'r2', 'unit_price'), '1,200');
    expect(byUid(res.items, 'r2')).toMatchObject({ unit_price: 1200, amount: 2400 });
  });
});

describe('cellRangeOps コピー', () => {
  it('見えている値をタブ区切りにし、工種行は名称列だけ値を持つ', () => {
    const tsv = rangeToTsv(base(), range('r1', 'name', 'r3', 'unit_price'));
    expect(tsv.split('\n')).toEqual([
      'r1\t\t1\t式\t100',
      'A 塗装工事\t\t\t\t',
      'r2\t\t2\t式\t50',
      'r3\t\t1\t式\t900',
    ]);
  });
});
