// 保存済みの見積（fetchEstimateById の結果）から、PDF（EstimateDocument）に渡すデータを作る。
//
// 見積一覧の「PDFプレビュー・印刷」はエディタを開かずにPDFを作るため、エディタのプレビュー
// （EstimateEditor の buildPreviewEstimate）と同じ形にここで整える:
//   - 明細をシートごとに振り分ける（読み込んだシートには明細が入っていない）
//   - リンク①②の値・シート合計を計算エンジンで解決する（保存時点の値のままにしない）
//   - 工種小計の注入（show_subtotals）・コメント行の符号化は保存・プレビューと同じ encodeSheetItemsForOutput
import { ITEM_TYPE, ITEM_SENTINEL } from '../utils/constants';
import { computeEstimateCalc, encodeSheetItemsForOutput } from './estimateCalc';

export const buildPdfEstimateFromSaved = (estimate) => {
  if (!estimate) return estimate;
  const sheets = Array.isArray(estimate.sheets) && estimate.sheets.length > 0
    ? estimate.sheets
    : [{ id: null, title: null }];
  const topSheetId = sheets[0].id;

  // 計算エンジンは行を _uid で扱う。保存済みのコメント行（item + センチネル）は画面と同じく COMMENT に戻す
  const items = (estimate.items || []).map((item, i) => {
    const base = item.item_type === ITEM_TYPE.ITEM && item.category_symbol === ITEM_SENTINEL.COMMENT
      ? { ...item, item_type: ITEM_TYPE.COMMENT, category_symbol: null }
      : item;
    return {
      ...base,
      sheet_id: base.sheet_id ?? topSheetId,
      _uid: base._uid ?? (base.id != null ? `saved:${base.id}` : `saved-row:${i}`),
    };
  });

  const { resolvedItems, sheetTotals } = computeEstimateCalc(sheets, items);
  const bySheet = new Map(sheets.map(s => [s.id, []]));
  resolvedItems.forEach((it) => {
    if (bySheet.has(it.sheet_id)) bySheet.get(it.sheet_id).push(it);
  });

  const pdfSheets = sheets.map((sheet) => ({
    id: sheet.id,
    title: sheet.title || '',
    items: encodeSheetItemsForOutput(bySheet.get(sheet.id) || [], {
      showSubtotals: !!estimate.show_subtotals,
      subtotalExtraFields: (sortOrder) => ({ sort_order: sortOrder }),
    }),
    sheetTotal: sheetTotals.get(sheet.id) ?? null,
  }));

  return { ...estimate, sheets: pdfSheets };
};
