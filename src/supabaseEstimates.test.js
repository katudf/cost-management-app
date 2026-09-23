import { describe, it, expect } from 'vitest';
import { calcTotals, calcTopSheetTotals, sumItemAmounts } from './supabaseEstimates';
import { ITEM_TYPE } from './utils/constants';

describe('sumItemAmounts', () => {
  // EstimatePDF/SheetPaperのシート合計フォールバックとcalcTotalsのitemTotal算出で、
  // ITEM行のamountだけを合計するreduceが3箇所にべた書きされていたための一本化（§9.20）。
  it('ITEM行のamountのみを合計する', () => {
    const items = [
      { item_type: ITEM_TYPE.ITEM, amount: 1000 },
      { item_type: ITEM_TYPE.ITEM, amount: 2000 },
      { item_type: ITEM_TYPE.CATEGORY, amount: 999999 },
      { item_type: ITEM_TYPE.COMMENT, amount: 999999 },
    ];
    expect(sumItemAmounts(items)).toBe(3000);
  });

  it('amountが未設定/文字列の行は0として扱う', () => {
    const items = [
      { item_type: ITEM_TYPE.ITEM, amount: null },
      { item_type: ITEM_TYPE.ITEM, amount: '500' },
    ];
    expect(sumItemAmounts(items)).toBe(500);
  });

  it('空配列の場合は0を返す', () => {
    expect(sumItemAmounts([])).toBe(0);
  });
});

describe('calcTotals', () => {
  it('ITEM行のamountのみを合計し、税・NETを算出する', () => {
    const items = [
      { item_type: ITEM_TYPE.ITEM, amount: 1000 },
      { item_type: ITEM_TYPE.ITEM, amount: 2000 },
      { item_type: ITEM_TYPE.CATEGORY, amount: 999999 }, // 集計対象外
    ];
    const result = calcTotals(items, 0.1, { type: 'perc', perc: 95 });
    expect(result.subtotal).toBe(3000);
    expect(result.tax).toBe(300);
    expect(result.total).toBe(3300);
    expect(result.net).toBe(Math.floor(3000 * 0.95));
  });

  it('net_calc_type=manualの場合はmanualAmountをそのまま使う', () => {
    const items = [{ item_type: ITEM_TYPE.ITEM, amount: 1000 }];
    const result = calcTotals(items, 0.1, { type: 'manual', manualAmount: 500 });
    expect(result.net).toBe(500);
  });

  it('netCalcSettings省略時は旧auto互換でperc95%扱い', () => {
    const items = [{ item_type: ITEM_TYPE.ITEM, amount: 1000 }];
    const result = calcTotals(items);
    expect(result.net).toBe(950);
  });
});

describe('calcTopSheetTotals', () => {
  // EstimateEditor/EstimatePDFの3箇所で「トップシートのITEM行を絞り込み、
  // header/estimateのtax_rate・net_calc系フィールドからcalcTotalsを呼ぶ」処理が
  // 重複していたための一本化（§9.18）。calcTotalsへの委譲と項目フィルタが
  // 正しく行われることを確認する。
  const topSheetItems = [
    { item_type: ITEM_TYPE.ITEM, amount: 1000 },
    { item_type: ITEM_TYPE.ITEM, amount: 1000 },
    { item_type: ITEM_TYPE.CATEGORY, amount: 99999 },
  ];

  it('source(header/estimate)のtax_rate・net_calc_type等からcalcTotals相当の結果を返す', () => {
    const source = { tax_rate: 0.08, net_calc_type: 'perc', net_perc: 90 };
    const result = calcTopSheetTotals(topSheetItems, source);
    expect(result.subtotal).toBe(2000);
    expect(result.tax).toBe(160);
    expect(result.total).toBe(2160);
    expect(result.net).toBe(Math.floor(2000 * 0.9));
  });

  it('tax_rateが未設定/0の場合は0.1にフォールバックする', () => {
    const source = { net_calc_type: 'perc', net_perc: 95 };
    const result = calcTopSheetTotals(topSheetItems, source);
    expect(result.tax).toBe(200);
    expect(result.total).toBe(2200);
  });

  it('net_calc_type=manualの場合はnet_amountをそのまま使う', () => {
    const source = { tax_rate: 0.1, net_calc_type: 'manual', net_amount: 1234 };
    const result = calcTopSheetTotals(topSheetItems, source);
    expect(result.net).toBe(1234);
  });
});
