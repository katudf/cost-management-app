/**
 * SheetPaper.jsx の buildSheetRows と EstimatePDF.jsx の buildSheetRowsPDF に
 * 重複していた行レイアウト計算（ダミー行の埋め計算・工種小計集計・行種別分類・
 * フッター行分岐）の一本化（§9.25）。
 *
 * 空行判定（isBlankRow）だけは呼び出し側で挙動が異なる（SheetPaper.jsx は
 * BLANK_SENTINEL 必須・null/undefinedのみ空扱い、EstimatePDF.jsx はセンチネル
 * 不要・空文字も空扱い）ため、パラメータとして注入する。
 */
import { ITEM_TYPE } from '../utils/constants';
import { sumItemAmounts } from '../supabaseEstimates';

export const buildSheetRowsShared = (
  items,
  header,
  isTopSheet,
  totals,
  sheetTotal,
  showTotalRow,
  isBlankRowFn,
  rowsPerPage
) => {
  const rows = [];

  const netRowCount = isTopSheet && header.show_net ? 1 : 0;
  const footerRowCount = isTopSheet ? 1 + netRowCount : (showTotalRow ? 1 : 0);

  const totalDataRows = items.length;
  const remainder = totalDataRows % rowsPerPage;
  let paddingCount;
  if (totalDataRows === 0) {
    paddingCount = rowsPerPage - footerRowCount;
  } else {
    const lastPageDataRows = remainder === 0 ? rowsPerPage : remainder;
    const availableForDummy = rowsPerPage - lastPageDataRows - footerRowCount;
    paddingCount = availableForDummy >= 0
      ? availableForDummy
      // フッターが最終ページに収まらない場合は丸ごと次ページに繰り越す
      : (remainder === 0 ? 0 : rowsPerPage - remainder) + (rowsPerPage - footerRowCount);
  }

  // 工種見出しごとの小計（見出し行の金額セルに表示）
  const catSubtotalMap = new Map();
  let currentCat = null;
  items.forEach((item) => {
    if (item.item_type === ITEM_TYPE.CATEGORY) {
      currentCat = item;
      catSubtotalMap.set(item, 0);
    } else if (item.item_type === ITEM_TYPE.ITEM && currentCat) {
      catSubtotalMap.set(currentCat, catSubtotalMap.get(currentCat) + (Number(item.amount) || 0));
    }
  });

  let itemNo = 0;
  items.forEach((item) => {
    if (item.item_type === ITEM_TYPE.CATEGORY) {
      rows.push({ kind: 'category', item, catTotal: catSubtotalMap.get(item) || 0 });
    } else if (item.item_type === ITEM_TYPE.COMMENT) {
      rows.push({ kind: 'comment', item });
    } else if (item.item_type === ITEM_TYPE.SUBTOTAL) {
      rows.push({ kind: 'subtotal', item });
    } else if (isBlankRowFn(item)) {
      rows.push({ kind: 'item', item, itemNo: null });
    } else {
      itemNo += 1;
      rows.push({ kind: 'item', item, itemNo });
    }
  });

  for (let i = 0; i < Math.max(0, paddingCount); i++) {
    rows.push({ kind: 'dummy' });
  }

  if (isTopSheet) {
    rows.push({ kind: 'total-ex-tax', amount: totals.subtotal });
    if (header.show_net) {
      rows.push({ kind: 'net', amount: totals.net });
    }
  } else if (showTotalRow) {
    const resolvedTotal = sheetTotal != null ? sheetTotal : sumItemAmounts(items);
    rows.push({ kind: 'sheet-total', amount: resolvedTotal });
  }

  return rows;
};
