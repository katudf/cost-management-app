// src/estimate-editor/rowBulkOps.js
// 明細行の複数行一括操作（純関数）。選択は常に1シート内の行 _uid の集合。
//
// items は全シート通しのフラット配列（各行に sheet_id）。ここの関数は対象シートの行だけを
// 組み替え、他シートの行の並びには触れない。変化がなければ同じ配列を返す。

import { ITEM_TYPE } from '../utils/constants';
import { computeAutoAmount } from './estimateCalc';

/** 行のドラッグ移動で使う DataTransfer の種類（紙面・左ナビが自分のドラッグか見分ける） */
export const ROW_DRAG_TYPE = 'application/x-estimate-rows';
export const isRowDragEvent = (e) => Array.from(e?.dataTransfer?.types || []).includes(ROW_DRAG_TYPE);

// ============================================================
// シート内の並び
// ============================================================

/** 指定シートの行（フラット配列での出現順） */
export const sheetRowsOf = (items, sheetId) => items.filter(it => it.sheet_id === sheetId);

/** 選択行をシート内の表示順で返す */
export const orderedSelection = (items, sheetId, uidSet) =>
  sheetRowsOf(items, sheetId).filter(it => uidSet.has(it._uid));

/** アンカー行から対象行までの範囲（両端含む・シート内の表示順）の _uid 配列 */
export const rangeUids = (items, sheetId, fromUid, toUid) => {
  const rows = sheetRowsOf(items, sheetId);
  const a = rows.findIndex(it => it._uid === fromUid);
  const b = rows.findIndex(it => it._uid === toUid);
  if (b < 0) return [];
  if (a < 0) return [toUid];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return rows.slice(lo, hi + 1).map(it => it._uid);
};

/**
 * 指定シートの行を newSheetRows で置き換える。シートの行は元の先頭位置にまとめて置き、
 * sort_order をシート内で 0..n に振り直す（他シートの行はそのまま）。
 */
export const replaceSheetRows = (items, sheetId, newSheetRows) => {
  const firstIdx = items.findIndex(it => it.sheet_id === sheetId);
  const others = items.filter(it => it.sheet_id !== sheetId);
  // 先頭のシート行より前にある他シート行の数＝差し込み位置
  const insertAt = firstIdx < 0
    ? others.length
    : items.slice(0, firstIdx).filter(it => it.sheet_id !== sheetId).length;
  const numbered = newSheetRows.map((it, i) => (it.sort_order === i ? it : { ...it, sort_order: i }));
  return [...others.slice(0, insertAt), ...numbered, ...others.slice(insertAt)];
};

// ============================================================
// 行の複製（新しい _uid を振り、DB の id は外す）
// ============================================================

/**
 * @param ids { uid: () => string, catTempId: () => string }
 */
export const cloneRow = (row, sheetId, ids) => {
  const { id, _tempId, _uid, ...rest } = row;
  return {
    ...rest,
    sheet_id: sheetId,
    _uid: ids.uid(),
    ...(row.item_type === ITEM_TYPE.CATEGORY ? { _tempId: ids.catTempId() } : {}),
  };
};

// ============================================================
// 一括操作
// ============================================================

/**
 * 選択行をまとめて削除する。シートが空になる場合は空の明細行を1行残す
 * （単一行削除の「最後の1行は残す」と同じ考え方）。
 */
export const removeRows = (items, sheetId, uidSet, makeEmptyRow) => {
  const rows = sheetRowsOf(items, sheetId);
  const kept = rows.filter(it => !uidSet.has(it._uid));
  if (kept.length === rows.length) return items;
  return replaceSheetRows(items, sheetId, kept.length ? kept : [makeEmptyRow(sheetId)]);
};

/** 選択行の直後（最後の選択行の下）に、選択行を表示順のまま複製する */
export const duplicateRows = (items, sheetId, uidSet, ids) => {
  const rows = sheetRowsOf(items, sheetId);
  const selected = rows.filter(it => uidSet.has(it._uid));
  if (selected.length === 0) return { items, newUids: [] };
  const copies = selected.map(r => cloneRow(r, sheetId, ids));
  const lastIdx = rows.findIndex(it => it._uid === selected[selected.length - 1]._uid);
  const next = [...rows.slice(0, lastIdx + 1), ...copies, ...rows.slice(lastIdx + 1)];
  return { items: replaceSheetRows(items, sheetId, next), newUids: copies.map(c => c._uid) };
};

/**
 * 選択行を1行ずつ上（dir='up'）または下へ動かす。離れた選択もそれぞれ1行動き、
 * 端に着いた行はそれ以上動かない（隣が選択行なら一緒に止まる）。
 */
export const moveRows = (items, sheetId, uidSet, dir) => {
  const rows = [...sheetRowsOf(items, sheetId)];
  let changed = false;
  if (dir === 'up') {
    for (let i = 1; i < rows.length; i++) {
      if (uidSet.has(rows[i]._uid) && !uidSet.has(rows[i - 1]._uid)) {
        [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
        changed = true;
      }
    }
  } else {
    for (let i = rows.length - 2; i >= 0; i--) {
      if (uidSet.has(rows[i]._uid) && !uidSet.has(rows[i + 1]._uid)) {
        [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
        changed = true;
      }
    }
  }
  return changed ? replaceSheetRows(items, sheetId, rows) : items;
};

/** anchorUid の行の直後（null ならシート末尾）へ newRows を挿入する */
export const insertRowsAfter = (items, sheetId, anchorUid, newRows) => {
  if (newRows.length === 0) return items;
  const rows = sheetRowsOf(items, sheetId);
  const idx = anchorUid == null ? -1 : rows.findIndex(it => it._uid === anchorUid);
  const at = idx < 0 ? rows.length : idx + 1;
  return replaceSheetRows(items, sheetId, [...rows.slice(0, at), ...newRows, ...rows.slice(at)]);
};

/**
 * 行を別の位置（同じシート内・別シートどちらも可）へ移す（ドラッグ移動）。
 * 行は識別子（_uid/_tempId/id）をそのまま保ち、所属シートだけを変える。そのため
 * 総括表などのリンクは切れない。離れた行は表示順のまま詰めて並べる。
 *
 * @param uidSet        動かす行の _uid
 * @param targetSheetId 移動先シート
 * @param anchor        { uid, position: 'before'|'after' }。null ならシート末尾
 * @param makeEmptyRow  移動元シートが空になったときに残す空行を作る (sheetId) => row
 * @returns 変化がなければ同じ配列
 */
export const moveRowsTo = (items, uidSet, targetSheetId, anchor, makeEmptyRow) => {
  const moving = items.filter(it => uidSet.has(it._uid));
  if (moving.length === 0) return items;
  if (anchor && uidSet.has(anchor.uid)) return items; // 自分自身の中には落とさない
  const sourceSheetIds = new Set(moving.map(r => r.sheet_id));

  const rest = items.filter(it => !uidSet.has(it._uid));
  const moved = moving.map(r => (r.sheet_id === targetSheetId ? r : { ...r, sheet_id: targetSheetId }));
  const targetRows = sheetRowsOf(rest, targetSheetId);
  let at = targetRows.length;
  if (anchor) {
    const i = targetRows.findIndex(r => r._uid === anchor.uid);
    if (i >= 0) at = anchor.position === 'before' ? i : i + 1;
  }
  const newTarget = [...targetRows.slice(0, at), ...moved, ...targetRows.slice(at)];

  // 同じシート内で並びが変わらなければ何もしない
  if (sourceSheetIds.size === 1 && sourceSheetIds.has(targetSheetId)) {
    const before = sheetRowsOf(items, targetSheetId).map(r => r._uid).join('|');
    if (before === newTarget.map(r => r._uid).join('|')) return items;
  }

  let next = replaceSheetRows(rest, targetSheetId, newTarget);
  sourceSheetIds.forEach(sid => {
    if (sid === targetSheetId) return;
    const left = sheetRowsOf(next, sid);
    // 移動元は空にしない（単一行削除の「最後の1行は残す」と同じ考え方）。残った行の番号も振り直す
    next = replaceSheetRows(next, sid, left.length ? left : [makeEmptyRow(sid)]);
  });
  return next;
};

// ============================================================
// クリップボード
// ------------------------------------------------------------
// text/plain には Excel に貼れるタブ区切り（名称・仕様・数量・単位・単価・摘要。
// セルへの Excel 貼り付け pasteTsv と同じ列順）、text/html には同じ表と、
// 行の種類・リンクを保った行データ（data-estimate-rows 属性）を入れる。
// ============================================================
export const ROWS_CLIPBOARD_APP = 'cost-management/estimate-rows';
const ROWS_CLIPBOARD_VERSION = 1;
const BLANK_SENTINEL = '__blank__';

const COPY_FIELDS = [
  'item_type', 'category_symbol', 'name', 'spec', 'quantity', 'unit',
  'unit_price', 'amount', 'note', 'linked_sheet_id', 'linked_category_item_id',
];
// リンクを外して貼るときに使う、コピー時点の実効値（計算エンジンの解決済み値）
const RESOLVED_FIELDS = ['name', 'quantity', 'unit', 'unit_price', 'amount', 'note'];

const isBlankRow = (row) => row.category_symbol === BLANK_SENTINEL;
const isCategory = (it) => it.item_type === ITEM_TYPE.CATEGORY;
const cellText = (v) => (v == null ? '' : String(v));

const tsvCellsOf = (row) => {
  if (isBlankRow(row)) return [''];
  if (row.item_type === ITEM_TYPE.CATEGORY) {
    return [`${row.category_symbol ? `${row.category_symbol} ` : ''}${cellText(row.name)}`];
  }
  if (row.item_type === ITEM_TYPE.COMMENT) return [cellText(row.name)];
  return [row.name, row.spec, row.quantity, row.unit, row.unit_price, row.note].map(cellText);
};

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * コピー内容を組み立てる。
 * @param rows      コピーする行（表示順・計算エンジン解決済みの行）
 * @param source    { estimateId, instanceKey }  貼り付け先が同じ見積か判定するため
 */
export const buildRowsClipboard = (rows, source) => {
  const payload = {
    app: ROWS_CLIPBOARD_APP,
    v: ROWS_CLIPBOARD_VERSION,
    estimateId: source.estimateId ?? null,
    instanceKey: source.instanceKey,
    rows: rows.map(r => {
      const out = {};
      COPY_FIELDS.forEach(f => { out[f] = r[f] ?? null; });
      const resolved = {};
      RESOLVED_FIELDS.forEach(f => { resolved[f] = r[f] ?? null; });
      out.resolved = resolved;
      // 工種行の元の識別子（切り取り→貼り付けで②リンクの参照先を保つため）
      out.refs = isCategory(r) ? { id: r.id ?? null, _tempId: r._tempId ?? null, _uid: r._uid ?? null } : null;
      return out;
    }),
  };
  const lines = rows.map(tsvCellsOf);
  const text = lines.map(cells => cells.join('\t')).join('\n');
  const json = encodeURIComponent(JSON.stringify(payload));
  const html = `<table data-estimate-rows="${json}">${
    lines.map(cells => `<tr>${cells.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
  }</table>`;
  return { payload, text, html };
};

const validPayload = (p) =>
  p && p.app === ROWS_CLIPBOARD_APP && p.v === ROWS_CLIPBOARD_VERSION && Array.isArray(p.rows) && p.rows.length > 0;

/**
 * クリップボードから行データを読む。html が無い場合に限り、
 * このタブで直前にコピーした内容と text が一致すればそれを使う。
 */
export const parseRowsClipboard = ({ html, text }, lastCopy) => {
  if (html) {
    const m = /data-estimate-rows="([^"]*)"/.exec(html);
    if (m) {
      try {
        const p = JSON.parse(decodeURIComponent(m[1]));
        if (validPayload(p)) return p;
      } catch { /* 壊れた内容は無視して text 判定へ */ }
    }
  }
  // html があるのに行データが無い＝Excel など別のアプリからのコピーなので、文字が同じでも使わない
  if (!html && lastCopy && text != null && lastCopy.text === text.replace(/\r\n?/g, '\n').replace(/\n$/, '')) {
    return lastCopy.payload;
  }
  return null;
};

/** タブ区切りテキストを行ごとのセル配列にする（末尾の改行は無視。空なら []） */
export const parseTsvCells = (text) => {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  return lines.map(line => line.split('\t'));
};

/** タブ区切りの数量・単価セルを数値にする（カンマ除去。数値でなければ元の文字のまま、空は ''） */
export const tsvNumber = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (s === '') return '';
  return Number.isNaN(Number(s)) ? v : Number(s);
};

/** Excel などから来たタブ区切りを明細行データ（payload.rows と同じ形）にする */
export const rowsFromTsv = (text) =>
  parseTsvCells(text).map(([name = '', spec = '', quantity = '', unit = '', unitPrice = '', note = '']) => ({
    // 金額はセル入力・セルへのTSV貼り付けと同じ規則（数量×単価）で計算する
    ...computeAutoAmount({
      item_type: ITEM_TYPE.ITEM, category_symbol: null,
      name, spec, quantity: tsvNumber(quantity), unit, unit_price: tsvNumber(unitPrice), amount: '', note,
      linked_sheet_id: null, linked_category_item_id: null,
    }),
    resolved: null,
    refs: null,
  }));

const refKeysOf = (r) => [r?.id, r?._tempId, r?._uid].filter(k => k != null).map(String);
const linkOf = (row) => (row.linked_sheet_id != null ? ['sheet', row.linked_sheet_id]
  : row.linked_category_item_id != null ? ['category', row.linked_category_item_id] : [null, null]);

/**
 * 行データを anchorUid の行の下（null ならシート末尾）へ貼り付ける。
 *
 * - 同じ見積から切り取った工種行（元の行がもう無い）は、元の識別子（id/_tempId/_uid）を
 *   引き継ぐ。総括表などがその工種を②リンクで参照していても切れないようにするため。
 * - リンクは「同じ見積」「参照先が貼り付け後に存在する」「循環にならない」ときだけ残し、
 *   それ以外はコピー時点の値（resolved）で固定する。
 *
 * @param opts.sameEstimate      コピー元と同じ見積か
 * @param opts.mapSheetId        保存で確定したシートIDへの読み替え（コピー後に保存した場合）
 * @param opts.wouldCreateCycle  estimateCalc.wouldCreateCycle
 * @returns { items, newUids }
 */
export const pasteRowsInto = (items, sheets, sheetId, anchorUid, dataRows, ids,
  { sameEstimate, mapSheetId = (id) => id, wouldCreateCycle }) => {
  const usedCatKeys = new Set(items.filter(isCategory).flatMap(refKeysOf));
  const built = dataRows.map(({ resolved, refs, ...fields }) => {
    const row = cloneRow(fields, sheetId, ids);
    if (sameEstimate && isCategory(row)) {
      const keys = refKeysOf(refs);
      if (keys.length && keys.every(k => !usedCatKeys.has(k))) {
        if (refs._uid != null) row._uid = refs._uid;
        if (refs._tempId != null) row._tempId = refs._tempId;
        if (refs.id != null) row.id = refs.id;
        keys.forEach(k => usedCatKeys.add(k));
      }
    }
    if (row.linked_sheet_id != null) row.linked_sheet_id = mapSheetId(row.linked_sheet_id);
    return { row, resolved };
  });

  const inserted = insertRowsAfter(items, sheetId, anchorUid, built.map(b => b.row));
  const sheetIds = new Set(sheets.map(s => s.id));
  const catKeys = new Set(inserted.filter(isCategory).flatMap(refKeysOf));
  const finalRows = built.map(({ row, resolved }) => {
    const [kind, target] = linkOf(row);
    if (!kind) return row;
    const exists = kind === 'sheet' ? sheetIds.has(target) : catKeys.has(String(target));
    if (sameEstimate && exists && !wouldCreateCycle(sheets, inserted, row, kind, target)) return row;
    return { ...row, ...(resolved || {}), linked_sheet_id: null, linked_category_item_id: null };
  });
  const changed = finalRows.some((r, i) => r !== built[i].row);
  return {
    items: changed ? insertRowsAfter(items, sheetId, anchorUid, finalRows) : inserted,
    newUids: finalRows.map(r => r._uid),
  };
};
