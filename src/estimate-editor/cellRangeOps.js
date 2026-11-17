// 明細シートのセル範囲選択と、範囲への消去・コピー・貼り付け（純関数）。
//
// 範囲は「アンカーのセル」と「先端のセル」で表す（{ uid, col }）。行は1シート内の
// 表示順で両端の間にある編集可能行（明細・工種・コメント・空行）、列は RANGE_COLS の
// 並びで両端の間にある列。リンク行や工種行の数値欄など、書き込めないセルは飛ばして数える。
import { ITEM_TYPE } from '../utils/constants';
import { parseTsvCells, tsvNumber } from './rowBulkOps';
import { computeAutoAmount } from './estimateCalc';

/** 紙面の列の並び（左→右）。金額は入力欄では data-col="__amount" */
export const RANGE_COLS = ['name', 'spec', 'quantity', 'unit', 'unit_price', 'amount', 'note'];
const NUMBER_COLS = new Set(['quantity', 'unit_price', 'amount']);

/** 入力欄の data-col を範囲の列名にする（金額欄・工種記号欄の読み替え） */
export const rangeColOf = (dataCol) => {
  if (dataCol === '__amount') return 'amount';
  if (dataCol === 'category_symbol') return 'name';
  return RANGE_COLS.includes(dataCol) ? dataCol : null;
};

const isRangeRow = (it) =>
  it.item_type === ITEM_TYPE.ITEM || it.item_type === ITEM_TYPE.CATEGORY || it.item_type === ITEM_TYPE.COMMENT;

/** 行ごとに範囲操作で書き込める列（紙面で入力欄が出る列と同じ） */
export const writableColsOf = (item) => {
  if (item.item_type === ITEM_TYPE.CATEGORY || item.item_type === ITEM_TYPE.COMMENT) return ['name'];
  // ② 工種小計リンク: 名称・数量・単位・単価・金額がリンク制御
  if (item.linked_category_item_id != null) return ['spec', 'note'];
  // ① 別シート合計リンク: 単価・金額・摘要がリンク制御
  if (item.linked_sheet_id != null) return ['name', 'spec', 'quantity', 'unit'];
  return RANGE_COLS;
};

/**
 * 範囲の行と列を求める。範囲がシートに無い・1セルだけのときは null。
 * @param range { sheetId, anchor: { uid, col }, focus: { uid, col } }
 * @returns { rows: item[], cols: string[] } | null
 */
export const resolveRange = (items, range) => {
  if (!range || !range.anchor || !range.focus) return null;
  const rows = items.filter(it => it.sheet_id === range.sheetId && isRangeRow(it));
  const a = rows.findIndex(it => it._uid === range.anchor.uid);
  const f = rows.findIndex(it => it._uid === range.focus.uid);
  const ca = RANGE_COLS.indexOf(range.anchor.col);
  const cf = RANGE_COLS.indexOf(range.focus.col);
  if (a < 0 || f < 0 || ca < 0 || cf < 0) return null;
  if (a === f && ca === cf) return null;
  return {
    rows: rows.slice(Math.min(a, f), Math.max(a, f) + 1),
    cols: RANGE_COLS.slice(Math.min(ca, cf), Math.max(ca, cf) + 1),
  };
};

/** 範囲に含まれるセルのキー（`${uid}:${col}`）の集合。表示の強調に使う */
export const rangeCellKeys = (items, range) => {
  const r = resolveRange(items, range);
  const keys = new Set();
  if (!r) return keys;
  r.rows.forEach(row => r.cols.forEach(col => keys.add(`${row._uid}:${col}`)));
  return keys;
};

// 1セルへ値を書く（数量・単価が変われば金額を再計算。金額列への書き込みは手入力の上書き扱い）
const writeCell = (row, col, raw) => {
  const value = NUMBER_COLS.has(col) ? tsvNumber(raw) : raw;
  if (col === 'quantity' || col === 'unit_price') return computeAutoAmount({ ...row, [col]: value });
  return { ...row, [col]: value };
};

/**
 * 範囲の各セルへ値を入れる。valueAt(r, c) が undefined のセルは触らない。
 * 金額列は数量・単価の再計算の後に書く（同じ行で両方入れたときに金額の指定を優先するため）。
 */
const applyToRange = (items, r, valueAt) => {
  const byUid = new Map();
  let changed = 0;
  let skipped = 0;
  r.rows.forEach((row, ri) => {
    const writable = writableColsOf(row);
    let next = row;
    const order = [...r.cols].sort((x, y) => (x === 'amount') - (y === 'amount'));
    order.forEach((col) => {
      const v = valueAt(ri, r.cols.indexOf(col));
      if (v === undefined) return;
      if (!writable.includes(col)) { skipped += 1; return; }
      next = writeCell(next, col, v);
      changed += 1;
    });
    if (next !== row) byUid.set(row._uid, next);
  });
  const nextItems = byUid.size ? items.map(it => byUid.get(it._uid) ?? it) : items;
  return { items: nextItems, changed, skipped };
};

/**
 * 範囲のセルを空にする（行は消さない）。
 * @returns { items, changed, skipped }  範囲が無ければ null
 */
export const clearRange = (items, range) => {
  const r = resolveRange(items, range);
  if (!r) return null;
  return applyToRange(items, r, () => '');
};

/**
 * 範囲へ貼り付ける。コピー元が1セルなら範囲全体へ同じ値を、複数セルなら範囲の左上から
 * 範囲の中だけに入れる（はみ出した分は捨て、範囲が大きくても繰り返さない。行は挿入しない）。
 * @returns { items, changed, skipped, truncated }  範囲が無い・中身が空なら null
 */
export const pasteIntoRange = (items, range, text) => {
  const r = resolveRange(items, range);
  const cells = parseTsvCells(text);
  if (!r || cells.length === 0) return null;
  const single = cells.length === 1 && cells[0].length === 1;
  let truncated = 0;
  if (!single) {
    cells.forEach((line, ri) => line.forEach((_, ci) => {
      if (ri >= r.rows.length || ci >= r.cols.length) truncated += 1;
    }));
  }
  const valueAt = single
    ? () => cells[0][0]
    : (ri, ci) => cells[ri]?.[ci];
  return { ...applyToRange(items, r, valueAt), truncated };
};

const cellText = (v) => (v == null ? '' : String(v));

/**
 * 範囲を Excel 用のタブ区切りにする。rows は計算エンジン解決済みの行（リンク行も見えている値を写す）。
 * 工種行・コメント行は名称列だけ値を持ち、他の列は空にする。
 */
export const rangeToTsv = (resolvedItems, range) => {
  const r = resolveRange(resolvedItems, range);
  if (!r) return null;
  return r.rows.map((row) => r.cols.map((col) => {
    if (row.item_type !== ITEM_TYPE.ITEM && col !== 'name') return '';
    if (row.item_type === ITEM_TYPE.CATEGORY) {
      return `${row.category_symbol ? `${row.category_symbol} ` : ''}${cellText(row.name)}`;
    }
    return cellText(row[col]);
  }).join('\t')).join('\n');
};

/**
 * Shift+↑↓ で範囲の先端を1行動かした先の行 uid（シート端なら現在のまま）。
 */
export const stepRangeRow = (items, sheetId, uid, dir) => {
  const rows = items.filter(it => it.sheet_id === sheetId && isRangeRow(it));
  const i = rows.findIndex(it => it._uid === uid);
  if (i < 0) return uid;
  const j = Math.min(rows.length - 1, Math.max(0, i + dir));
  return rows[j]._uid;
};
