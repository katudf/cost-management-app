import { describe, it, expect } from 'vitest';
import { ITEM_TYPE } from '../utils/constants';
import { adjustValue, adjustPrices, countAdjustableRows, isValidPercent, isUnusualPercent } from './priceAdjustOps';

const item = (uid, extra = {}) => ({
  _uid: uid, sheet_id: 'A', item_type: ITEM_TYPE.ITEM,
  name: uid, quantity: 2, unit: '式', unit_price: 1000, amount: 2000, ...extra,
});
const byUid = (items, uid) => items.find(i => i._uid === uid);

describe('adjustValue 端数処理', () => {
  it('掛率を掛けて単位・方法で丸める', () => {
    expect(adjustValue(1000, 90)).toBe(900);          // 誤差で 899 にならない
    expect(adjustValue(1234, 90, 1, 'floor')).toBe(1110);  // 1110.6
    expect(adjustValue(1234, 90, 1, 'round')).toBe(1111);
    expect(adjustValue(1234, 90, 10, 'floor')).toBe(1110);
    expect(adjustValue(1234, 90, 10, 'ceil')).toBe(1120);
    expect(adjustValue(1234, 90, 100, 'round')).toBe(1100);
    expect(adjustValue(3300, 110, 1, 'floor')).toBe(3630); // 3630.0000000000005 を切り捨てない
  });

  it('掛率は0より大きい数だけ有効', () => {
    expect(isValidPercent('90')).toBe(true);
    expect(isValidPercent(0)).toBe(false);
    expect(isValidPercent('')).toBe(false);
    expect(isValidPercent('abc')).toBe(false);
  });
});

describe('adjustPrices', () => {
  const base = () => [
    item('r1'),                                                         // 自動計算の行
    item('r2', { quantity: 1, unit_price: 500, amount: 480 }),          // 金額を手で上書き
    item('r3', { quantity: '', unit_price: '', amount: 50000 }),        // 金額だけ（一式）
    item('r4', { quantity: 1, unit_price: -30000, amount: -30000 }),    // 値引き
    item('r5', { linked_sheet_id: 'B', unit_price: 9000, amount: 9000, quantity: 1 }), // リンク①
    item('r6', { quantity: null, unit_price: null, amount: null }),     // 空行
    { _uid: 'c1', sheet_id: 'A', item_type: ITEM_TYPE.CATEGORY, name: '塗装工事' },
    item('r7'),                                                         // 対象外の行
  ];
  const uids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'c1'];

  it('単価・手上書き金額・金額だけの行に掛け、マイナスとリンク行は飛ばして数える', () => {
    const res = adjustPrices(base(), uids, { percent: 90, unit: 1, mode: 'floor' });
    expect(byUid(res.items, 'r1')).toMatchObject({ unit_price: 900, amount: 1800 });
    expect(byUid(res.items, 'r2')).toMatchObject({ unit_price: 450, amount: 432 });
    expect(byUid(res.items, 'r3')).toMatchObject({ unit_price: '', amount: 45000 });
    expect(byUid(res.items, 'r4')).toMatchObject({ unit_price: -30000, amount: -30000 });
    expect(byUid(res.items, 'r5')).toMatchObject({ unit_price: 9000 });
    expect(byUid(res.items, 'r7')).toMatchObject({ unit_price: 1000, amount: 2000 });
    expect(res).toMatchObject({ changed: 3, skippedNegative: 1, skippedLinked: 1 });
  });

  it('自動計算の行は丸めた単価×数量で金額を出す（数量に小数があっても単価を丸める）', () => {
    const res = adjustPrices([item('q', { quantity: 2.5, unit_price: 1234, amount: 3085 })], ['q'],
      { percent: 90, unit: 10, mode: 'floor' });
    expect(byUid(res.items, 'q')).toMatchObject({ unit_price: 1110, amount: 2775 });
  });

  it('掛率が無効・100%で変化なしなら元の配列を返す', () => {
    const items = base();
    expect(adjustPrices(items, uids, { percent: '' }).items).toBe(items);
    const same = adjustPrices([item('x')], ['x'], { percent: 100 });
    expect(same.changed).toBe(0);
  });

  it('対象件数は変えられる行だけ数える（マイナス・リンク・空行・工種行は数えない）', () => {
    expect(countAdjustableRows(base(), uids)).toBe(3); // r1〜r3
  });

  it('50%未満・200%超の掛率は打ち間違いを疑う', () => {
    expect(isUnusualPercent(90)).toBe(false);
    expect(isUnusualPercent('200')).toBe(false);
    expect(isUnusualPercent(900)).toBe(true);
    expect(isUnusualPercent(9)).toBe(true);
  });
});
