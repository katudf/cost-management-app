import { describe, it, expect } from 'vitest';
import { buildSheetRowsShared } from './sheetRowLayout';
import { ITEM_TYPE } from '../utils/constants';

// SheetPaper.jsx の buildSheetRows と EstimatePDF.jsx の buildSheetRowsPDF に
// 重複していたレイアウト計算の一本化（§9.25）。

const ROWS_PER_PAGE = 19;

// SheetPaper.jsx 相当: BLANK_SENTINEL 必須・null/undefinedのみ空扱い
const BLANK_SENTINEL = '__blank__';
const isBlankRowSentinel = (item) =>
  item.category_symbol === BLANK_SENTINEL &&
  !item.name && !item.spec &&
  item.quantity == null && item.unit_price == null;

// EstimatePDF.jsx 相当: センチネル不要・空文字も空扱い
const isBlankRowLoose = (item) =>
  !item.name && !item.spec &&
  (item.quantity == null || item.quantity === '') &&
  (item.unit_price == null || item.unit_price === '');

const makeItem = (overrides = {}) => ({
  id: 1,
  item_type: ITEM_TYPE.ITEM,
  name: '材料A',
  spec: '',
  quantity: 1,
  unit_price: 100,
  amount: 100,
  ...overrides,
});

describe('buildSheetRowsShared', () => {
  it('items が空なら フッター分を除いた行がダミーで埋まる・トップシートは合計2行のみ', () => {
    const totals = { exTax: 0, tax: 0, net: 0 };
    const rows = buildSheetRowsShared([], { show_net: true }, true, totals, null, true, isBlankRowSentinel, ROWS_PER_PAGE);
    // footerRowCount = 1(total-ex-tax) + 1(net) = 2 → paddingCount = 19 - 2 = 17
    expect(rows.filter(r => r.kind === 'dummy').length).toBe(ROWS_PER_PAGE - 2);
    expect(rows.filter(r => r.kind === 'total-ex-tax').length).toBe(1);
    expect(rows.filter(r => r.kind === 'net').length).toBe(1);
  });

  it('ROWS_PER_PAGEの倍数個の行でフッターなしなら次ページの埋めは不要', () => {
    const items = Array.from({ length: ROWS_PER_PAGE }, (_, i) => makeItem({ id: i + 1 }));
    // showTotalRow=false・サブシートなのでフッター行なし → ちょうど1ページに収まりダミー0
    const rows = buildSheetRowsShared(items, {}, false, {}, 1900, false, isBlankRowSentinel, ROWS_PER_PAGE);
    const dummyCount = rows.filter(r => r.kind === 'dummy').length;
    expect(dummyCount).toBe(0);
  });

  it('余りがある場合は残り行数だけダミーで埋める（フッターが収まる場合）', () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem({ id: i + 1 }));
    // showTotalRow=false なのでフッター行なし、余り19-5=14行がすべてダミーになる
    const rows = buildSheetRowsShared(items, {}, false, {}, 1900, false, isBlankRowSentinel, ROWS_PER_PAGE);
    const dummyCount = rows.filter(r => r.kind === 'dummy').length;
    expect(dummyCount).toBe(ROWS_PER_PAGE - 5);
  });

  it('フッターが最終ページに収まらない場合は丸ごと次ページへ繰り越す', () => {
    // トップシート・show_net=true(footerRowCount=2)でデータがちょうど1ページ分(19件)ある場合、
    // 最終ページにフッター2行が収まらないため丸ごと次ページへ繰り越す
    const items = Array.from({ length: ROWS_PER_PAGE }, (_, i) => makeItem({ id: i + 1 }));
    const totals = { exTax: 0, tax: 0, net: 0 };
    const rows = buildSheetRowsShared(items, { show_net: true }, true, totals, null, true, isBlankRowSentinel, ROWS_PER_PAGE);
    const dummyCount = rows.filter(r => r.kind === 'dummy').length;
    // remainder = 0, lastPageDataRows = 19, availableForDummy = 19-19-2 = -2 < 0
    // → (remainder===0 ? 0 : ...) + (19 - 2) = 0 + 17 = 17
    expect(dummyCount).toBe(ROWS_PER_PAGE - 2);
  });

  it('sheetTotal が指定されていればそれを使い、nullならsumItemAmountsにフォールバックする', () => {
    const items = [makeItem({ amount: 300 }), makeItem({ id: 2, amount: 400 })];
    const rowsWithTotal = buildSheetRowsShared(items, {}, false, {}, 999, true, isBlankRowSentinel, ROWS_PER_PAGE);
    const totalRowWithTotal = rowsWithTotal.find(r => r.kind === 'sheet-total');
    expect(totalRowWithTotal.amount).toBe(999);

    const rowsFallback = buildSheetRowsShared(items, {}, false, {}, null, true, isBlankRowSentinel, ROWS_PER_PAGE);
    const totalRowFallback = rowsFallback.find(r => r.kind === 'sheet-total');
    expect(totalRowFallback.amount).toBe(700);
  });

  it('showTotalRow が false ならサブシートに合計行を出さない', () => {
    const items = [makeItem()];
    const rows = buildSheetRowsShared(items, {}, false, {}, 100, false, isBlankRowSentinel, ROWS_PER_PAGE);
    expect(rows.some(r => r.kind === 'sheet-total')).toBe(false);
  });

  it('工種の小計を正しく集計する（複数工種）', () => {
    const items = [
      { id: 10, item_type: ITEM_TYPE.CATEGORY, name: '工種A' },
      makeItem({ id: 11, amount: 100 }),
      makeItem({ id: 12, amount: 200 }),
      { id: 13, item_type: ITEM_TYPE.SUBTOTAL, category_id: 10 },
      { id: 20, item_type: ITEM_TYPE.CATEGORY, name: '工種B' },
      makeItem({ id: 21, amount: 50 }),
      { id: 23, item_type: ITEM_TYPE.SUBTOTAL, category_id: 20 },
    ];
    const rows = buildSheetRowsShared(items, {}, false, {}, 350, false, isBlankRowSentinel, ROWS_PER_PAGE);
    const categoryRows = rows.filter(r => r.kind === 'category');
    expect(categoryRows[0].catTotal).toBe(300);
    expect(categoryRows[1].catTotal).toBe(50);
  });

  it('category/comment 行は itemNo を持たず種別のみで分類される', () => {
    const items = [
      { id: 1, item_type: ITEM_TYPE.CATEGORY, name: '工種A' },
      { id: 2, item_type: ITEM_TYPE.COMMENT, name: '備考' },
      makeItem({ id: 3 }),
    ];
    const rows = buildSheetRowsShared(items, {}, false, {}, 0, false, isBlankRowSentinel, ROWS_PER_PAGE);
    expect(rows[0].kind).toBe('category');
    expect(rows[1].kind).toBe('comment');
    expect(rows[2].kind).toBe('item');
    expect(rows[2].itemNo).toBe(1);
  });

  it('空行はitemNoがnullになり、後続の番号がスキップされない（詰まる）', () => {
    const blankItem = { id: 1, item_type: ITEM_TYPE.ITEM, category_symbol: BLANK_SENTINEL, name: '', spec: '', quantity: null, unit_price: null };
    const items = [makeItem({ id: 2 }), blankItem, makeItem({ id: 3 })];
    const rows = buildSheetRowsShared(items, {}, false, {}, 0, false, isBlankRowSentinel, ROWS_PER_PAGE);
    const itemRows = rows.filter(r => r.kind === 'item');
    expect(itemRows[0].itemNo).toBe(1);
    expect(itemRows[1].itemNo).toBeNull();
    expect(itemRows[2].itemNo).toBe(2);
  });

  it('sentinel判定: category_symbolがBLANK_SENTINELでなければ空扱いしない（quantity/unit_priceがnullでも）', () => {
    const item = { id: 1, item_type: ITEM_TYPE.ITEM, category_symbol: undefined, name: '', spec: '', quantity: null, unit_price: null };
    const rows = buildSheetRowsShared([item], {}, false, {}, 0, false, isBlankRowSentinel, ROWS_PER_PAGE);
    expect(rows[0].itemNo).toBe(1); // 空扱いされないので番号がつく
  });

  it('loose判定: センチネルなしでも空文字なら空行扱いになる（EstimatePDF.jsx相当）', () => {
    const item = { id: 1, item_type: ITEM_TYPE.ITEM, name: '', spec: '', quantity: '', unit_price: '' };
    const rows = buildSheetRowsShared([item], {}, false, {}, 0, false, isBlankRowLoose, ROWS_PER_PAGE);
    expect(rows[0].itemNo).toBeNull();
  });

  it('同じ入力でも述語が異なれば判定が分かれる（quantity=""・センチネルなし）', () => {
    const item = { id: 1, item_type: ITEM_TYPE.ITEM, name: '', spec: '', quantity: '', unit_price: '' };
    const sentinelRows = buildSheetRowsShared([item], {}, false, {}, 0, false, isBlankRowSentinel, ROWS_PER_PAGE);
    const looseRows = buildSheetRowsShared([item], {}, false, {}, 0, false, isBlankRowLoose, ROWS_PER_PAGE);
    // sentinel判定: category_symbolがBLANK_SENTINELでないため空扱いされない → itemNoが付く
    expect(sentinelRows[0].itemNo).toBe(1);
    // loose判定: quantity===''なので空扱い → itemNoはnull
    expect(looseRows[0].itemNo).toBeNull();
  });
});
