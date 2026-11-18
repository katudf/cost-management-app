import { describe, it, expect } from 'vitest';
import { ITEM_TYPE } from '../utils/constants';
import { buildPdfEstimateFromSaved } from './savedEstimatePdfData';
import { buildLinkSymbolLabeler } from './sheetRowLayout';

// fetchEstimateById が返す形（シートに明細は入っておらず、明細は estimate.items にまとめて入る）
const saved = () => ({
  id: 1,
  title: '外壁塗装',
  show_subtotals: false,
  sheets: [
    { id: 's-top', sort_order: 1, title: '総括表' },
    { id: 's-1', sort_order: 2, title: null },
  ],
  items: [
    // 総括表: 工種小計リンク行（保存時点の古い値が入っている）
    { id: 10, sheet_id: 's-top', item_type: ITEM_TYPE.ITEM, name: '古い名前', quantity: 1, unit: '式',
      unit_price: 1, amount: 1, linked_category_item_id: 20, sort_order: 1 },
    // 明細シート
    { id: 20, sheet_id: 's-1', item_type: ITEM_TYPE.CATEGORY, category_symbol: 'A', name: '仮設工事', sort_order: 2 },
    { id: 21, sheet_id: 's-1', item_type: ITEM_TYPE.ITEM, name: '足場', quantity: 2, unit_price: 1500, amount: 3000, sort_order: 3 },
    { id: 22, sheet_id: 's-1', item_type: ITEM_TYPE.ITEM, category_symbol: '__comment__', name: '※注記', sort_order: 4 },
  ],
});

describe('buildPdfEstimateFromSaved', () => {
  it('明細をシートごとに振り分け、リンク行とシート合計を解決する', () => {
    const pdf = buildPdfEstimateFromSaved(saved());
    expect(pdf.sheets.map(s => s.items.length)).toEqual([1, 3]);
    const [top, detail] = pdf.sheets;
    expect(top.items[0]).toMatchObject({ name: '仮設工事', unit_price: 3000, amount: 3000 });
    expect(top.sheetTotal).toBe(3000);
    expect(detail.sheetTotal).toBe(3000);
    // コメント行は出力用にセンチネルへ戻る
    expect(detail.items[2]).toMatchObject({ item_type: ITEM_TYPE.ITEM, category_symbol: '__comment__' });
  });

  it('総括表の No. に出す工種記号を、振り分けた明細から引ける', () => {
    const pdf = buildPdfEstimateFromSaved(saved());
    const labelOf = buildLinkSymbolLabeler(pdf.sheets.flatMap(s => s.items));
    expect(labelOf(pdf.sheets[0].items[0])).toBe('A');
  });

  it('シートの無い古い見積は1枚のシートにまとめる', () => {
    const est = { ...saved(), sheets: [] };
    est.items = est.items.map(({ sheet_id, linked_category_item_id, ...rest }) => rest); // eslint-disable-line no-unused-vars
    const pdf = buildPdfEstimateFromSaved(est);
    expect(pdf.sheets).toHaveLength(1);
    expect(pdf.sheets[0].items).toHaveLength(4);
  });
});
