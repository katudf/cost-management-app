import { describe, it, expect } from 'vitest';
import { computeAmountFallback } from './purchaseLedgerUtils';

describe('computeAmountFallback', () => {
  // PurchaseLedgerTab.jsxに3箇所べた書きされていたための一本化（§9.23）。
  it('amountが入力済みならその数値を返す', () => {
    expect(computeAmountFallback({ amount: 5000, quantity: 10, unit_price: 100 })).toBe(5000);
  });

  it('amountが文字列でも数値化して返す', () => {
    expect(computeAmountFallback({ amount: '5000', quantity: '', unit_price: '' })).toBe(5000);
  });

  it('amountがnull/undefined/空文字なら数量×単価で補完する', () => {
    expect(computeAmountFallback({ amount: null, quantity: 10, unit_price: 100 })).toBe(1000);
    expect(computeAmountFallback({ amount: undefined, quantity: 10, unit_price: 100 })).toBe(1000);
    expect(computeAmountFallback({ amount: '', quantity: 10, unit_price: 100 })).toBe(1000);
  });

  it('数量が空文字なら補完せずnullを返す（未入力を0として扱わない）', () => {
    expect(computeAmountFallback({ amount: '', quantity: '', unit_price: 100 })).toBeNull();
  });

  it('単価が空文字なら補完せずnullを返す', () => {
    expect(computeAmountFallback({ amount: '', quantity: 10, unit_price: '' })).toBeNull();
  });

  it('数量・単価がnull/undefinedなら補完せずnullを返す', () => {
    expect(computeAmountFallback({ amount: null, quantity: null, unit_price: 100 })).toBeNull();
    expect(computeAmountFallback({ amount: null, quantity: 10, unit_price: undefined })).toBeNull();
  });

  it('数量・単価が数値変換不能ならnullを返す', () => {
    expect(computeAmountFallback({ amount: '', quantity: 'abc', unit_price: 100 })).toBeNull();
  });

  it('amountが非数値文字列ならnullを返す', () => {
    expect(computeAmountFallback({ amount: 'abc', quantity: 10, unit_price: 100 })).toBeNull();
  });
});
