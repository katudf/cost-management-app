// src/estimate-editor/SheetPaper.jsx
// 明細シート1枚を紙面（A4横 1123×794px）そのままのレイアウトで表示する。
// 1シートが19行/ページを超える場合は複数ページに分割して縦に積む。
//
// 移植元: src/EstimatePDF.jsx の DetailPage（テーブル罫線・行高・ダミー行
// パディングのアルゴリズムは同一）。ただしフッター行の構成は新シートモデル
// （design.md §4）に合わせて変更している:
//   - トップシート(sheetIndex 0): FIXED行(show_fixed_fees時) ＋「税抜合計」1行
//     ＋ NET行(show_net時)。消費税・税込合計は鑑側にのみ表示する。
//   - サブシート: 「合　計」1行のみ（シート内 ITEM 金額の合計）。
// Phase 6 で EstimatePDF.jsx をこの構成に追従させる。
//
// Phase 4: セル編集グリッド化。item/category/comment 行を紙面上の透明インライン
// input で直接編集できる。Tab/Enter で次セルへ、矢印上下で同列の前後行へ移動し、
// 行左のホバーツールバーで行操作（上下移動/追加/複製/削除）、セルへの TSV 貼り付けに
// 対応する。isLocked 時（または編集ハンドラ未指定時）はプレーンテキスト描画。
//
// 編集ハンドラは EstimateEditor から props で受け取り、対象行は配列 index ではなく
// クライアント安定キー `_uid` で指定する（SheetPaper はシートローカルな items しか
// 持たず、フラット配列内の絶対 index を知らないため）。
import React, { useRef, useCallback, useState } from 'react';
import { Plus, Trash2, Copy, ChevronUp, ChevronDown, Link2, Link2Off } from 'lucide-react';
import { ITEM_TYPE } from '../utils/constants';
import {
  pt, PAPER_WIDTH, PAPER_HEIGHT, ROWS_PER_PAGE, COLORS, page, table, fmt,
} from './paperStyles';

// 空行センチネル（design.md §4: 空行は保持し、category_symbol で識別する）
const BLANK_SENTINEL = '__blank__';

// item 行の編集可能列（Tab順。金額列は自動計算のためナビ対象外）
const ITEM_COL_KEYS = ['name', 'spec', 'quantity', 'unit', 'unit_price', 'note'];
// category 行は記号＋名称の2列
const CATEGORY_COL_KEYS = ['category_symbol', 'name'];
// comment 行は本文1列
const COMMENT_COL_KEYS = ['name'];

const colKeysFor = (item) => {
  if (item.item_type === ITEM_TYPE.CATEGORY) return CATEGORY_COL_KEYS;
  if (item.item_type === ITEM_TYPE.COMMENT) return COMMENT_COL_KEYS;
  // リンク行（Phase 5）はリンク制御列を input で出さないため Tab ナビからも除外する。
  // ② カテゴリ小計リンク: 名称・数量・単位・単価がリンク制御 → 仕様のみ編集可。
  // ① 別シート合計リンク: 単価・摘要がリンク制御 → 名称・仕様・数量・単位が編集可。
  if (item.linked_category_item_id != null) return ['spec'];
  if (item.linked_sheet_id != null) return ['name', 'spec', 'quantity', 'unit'];
  return ITEM_COL_KEYS;
};

const isBlankRow = (item) =>
  item.category_symbol === BLANK_SENTINEL &&
  !item.name && !item.spec &&
  item.quantity == null && item.unit_price == null;

const isNavigable = (type) =>
  type === ITEM_TYPE.ITEM || type === ITEM_TYPE.CATEGORY || type === ITEM_TYPE.COMMENT;

// ============================================================
// 数値入力ヘルパ（EstimateItemTable.jsx より移植）
// ============================================================
// 負数は "▲" 表記にする（例: -1234 → ▲1,234）
const formatNumberInput = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  const formatted = Math.abs(num).toLocaleString('ja-JP', { maximumFractionDigits: 10 });
  return num < 0 ? `▲${formatted}` : formatted;
};

// 全角数字・カンマ・▲/全角マイナスを除去して数値文字列に戻す
// （末尾の小数点は入力途中として許容）
const parseNumberInput = (raw) => {
  const leadingSignMatch = raw.match(/^\s*([▲－-])/);
  const isNegative = !!leadingSignMatch;
  const rest = isNegative ? raw.slice(leadingSignMatch[0].length) : raw;
  const halfWidth = rest.replace(/[０-９．]/g, (c) =>
    c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const digits = halfWidth.replace(/,/g, '');
  return isNegative && digits !== '' ? `-${digits}` : digits;
};

// ============================================================
// 行リスト構築（データ行＋ダミー行＋フッター行）
// ============================================================
// DetailPage のパディングアルゴリズムを踏襲: 最終ページの
// データ行＋フッター行が19行に満たない分をダミー行で埋め、
// フッター行が必ず最終ページ末尾に収まるようにする。
// 返り値は行記述子 {kind, item?, itemNo?, catTotal?, label?, amount?} の配列で、
// 長さは必ず ROWS_PER_PAGE の倍数になる。
export const buildSheetRows = (items, header, isTopSheet, totals, sheetTotal) => {
  const nonFixed = items.filter(i => i.item_type !== ITEM_TYPE.FIXED);
  const fixedItems = items.filter(i => i.item_type === ITEM_TYPE.FIXED);

  const showFixed = isTopSheet && header.show_fixed_fees;
  const fixedFeeRows = showFixed ? fixedItems.length : 0;
  const netRowCount = isTopSheet && header.show_net ? 1 : 0;
  // トップシート: FIXED行＋税抜合計＋NET / サブシート: 合計1行
  const footerRows = isTopSheet ? fixedFeeRows + 1 + netRowCount : 1;

  const totalDataRows = nonFixed.length;
  const remainder = totalDataRows % ROWS_PER_PAGE;
  let paddingCount;
  if (totalDataRows === 0) {
    paddingCount = ROWS_PER_PAGE - footerRows;
  } else {
    const lastPageDataRows = remainder === 0 ? ROWS_PER_PAGE : remainder;
    const availableForDummy = ROWS_PER_PAGE - lastPageDataRows - footerRows;
    paddingCount = availableForDummy >= 0
      ? availableForDummy
      // 最終ページにフッターが収まらない場合はページを繰り越す
      : (remainder === 0 ? 0 : ROWS_PER_PAGE - remainder) + (ROWS_PER_PAGE - footerRows);
  }

  // 工種見出しごとの小計（見出し行の金額セルに表示）
  const catSubtotalMap = new Map();
  let currentCat = null;
  nonFixed.forEach(item => {
    if (item.item_type === ITEM_TYPE.CATEGORY) {
      currentCat = item;
      catSubtotalMap.set(item, 0);
    } else if (item.item_type === ITEM_TYPE.ITEM && currentCat) {
      catSubtotalMap.set(currentCat, catSubtotalMap.get(currentCat) + (Number(item.amount) || 0));
    }
  });

  const rows = [];
  let itemNo = 0;
  nonFixed.forEach(item => {
    if (item.item_type === ITEM_TYPE.CATEGORY) {
      rows.push({ kind: 'category', item, catTotal: catSubtotalMap.get(item) || 0 });
    } else if (item.item_type === ITEM_TYPE.COMMENT) {
      rows.push({ kind: 'comment', item });
    } else if (item.item_type === ITEM_TYPE.SUBTOTAL) {
      rows.push({ kind: 'subtotal', item });
    } else if (isBlankRow(item)) {
      // 空行はNo.を振らず空欄のまま印字する（編集時はセル入力できる）
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
    if (showFixed) {
      fixedItems.forEach(item => rows.push({ kind: 'fixed', item }));
    }
    rows.push({ kind: 'total-ex-tax', amount: totals.subtotal });
    if (header.show_net) {
      rows.push({ kind: 'net', amount: totals.net });
    }
  } else {
    // 計算エンジン（Phase 5）がリンク解決済みのシート合計を渡す場合はそれを優先。
    // 渡されない場合（呼び出し元未対応・ページ数計算のみ等）は ITEM 金額を単純合算。
    const resolvedTotal = sheetTotal != null
      ? sheetTotal
      : items.reduce(
          (sum, i) => sum + (i.item_type === ITEM_TYPE.ITEM ? (Number(i.amount) || 0) : 0), 0
        );
    rows.push({ kind: 'sheet-total', amount: resolvedTotal });
  }

  return rows;
};

// シートが占めるページ数（EstimateEditor が通しページ番号を計算するのに使う）
export const calcSheetPageCount = (items, header, isTopSheet, totals) =>
  buildSheetRows(items, header, isTopSheet, totals).length / ROWS_PER_PAGE;

// ============================================================
// セルスタイル
// ============================================================
const dashedRight = `${pt(0.5)}px dashed ${COLORS.dashed}`;

// 各セルは行の高さいっぱいに伸ばし（borderRightを行全体に通すため）、
// 中のテキストを縦中央に配置する
const cellBase = {
  display: 'flex',
  alignItems: 'center',
  boxSizing: 'border-box',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  fontSize: table.cellFontSize,
  paddingLeft: table.cellPaddingX,
  paddingRight: table.cellPaddingX,
  borderRight: dashedRight,
};

const CELLS = {
  no:     { ...cellBase, width: table.colNoWidth, paddingLeft: table.cellPaddingXNarrow, paddingRight: table.cellPaddingXNarrow, justifyContent: 'center', flexShrink: 0 },
  name:   { ...cellBase, flex: table.nameFlex },
  spec:   { ...cellBase, flex: table.specFlex, color: COLORS.subInk },
  qty:    { ...cellBase, width: table.colQtyWidth, justifyContent: 'flex-end', flexShrink: 0 },
  unit:   { ...cellBase, width: table.colUnitWidth, paddingLeft: table.cellPaddingXNarrow, paddingRight: table.cellPaddingXNarrow, justifyContent: 'center', flexShrink: 0 },
  price:  { ...cellBase, width: table.colPriceWidth, justifyContent: 'flex-end', flexShrink: 0 },
  amount: { ...cellBase, width: table.colAmountWidth, justifyContent: 'flex-end', flexShrink: 0 },
  note:   { ...cellBase, flex: table.noteFlex, color: COLORS.noteInk, borderRight: 'none' },
};

const solidBottom = `${pt(1)}px solid ${COLORS.ink}`;
const dashedBottom = `${pt(0.5)}px dashed ${COLORS.dashed}`;

const rowBase = {
  display: 'flex',
  height: table.rowHeight,
  boxSizing: 'border-box',
  borderBottom: dashedBottom,
  borderLeft: `${pt(1)}px solid ${COLORS.ink}`,
  borderRight: `${pt(1)}px solid ${COLORS.ink}`,
  // 各セルが自前で overflow:hidden するため行では clip 不要。
  // 行を clip すると行ツールバー（左外）とリンクピッカー（下方向・最大300px）が
  // 切れてしまうため visible にする。
  overflow: 'visible',
  position: 'relative',
};

// セル内に敷く透明インライン input の共通スタイル。
// 罫線・背景を持たず、セルのテキストとまったく同じ見た目になるようにする。
const inputBase = {
  width: '100%',
  height: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  fontSize: table.cellFontSize,
  fontFamily: 'inherit',
  color: 'inherit',
  boxSizing: 'border-box',
};

// ============================================================
// 編集用インライン input
// ============================================================
// テキスト列（名称・仕様・単位・摘要・工種名・記号・コメント）用
const TextCell = ({ uid, col, value, align, color, bold, italic, placeholder, onChange, onPaste, onKeyDown }) => (
  <input
    type="text"
    data-uid={uid}
    data-col={col}
    value={value || ''}
    placeholder={placeholder}
    onChange={(e) => onChange(col, e.target.value)}
    onPaste={onPaste}
    onKeyDown={onKeyDown}
    style={{
      ...inputBase,
      textAlign: align || 'left',
      ...(color ? { color } : {}),
      ...(bold ? { fontWeight: 'bold' } : {}),
      ...(italic ? { fontStyle: 'italic' } : {}),
    }}
  />
);

// カンマ区切りの数値入力欄（フォーカス中は生値、blur で整形表示）
const NumberCell = ({ uid, col, value, onChange, onPaste, onKeyDown }) => {
  const [draft, setDraft] = useState(null);
  const displayValue = draft !== null ? draft : formatNumberInput(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      data-uid={uid}
      data-col={col}
      value={displayValue}
      onFocus={() => setDraft(String(value ?? ''))}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(col, parseNumberInput(e.target.value));
      }}
      onBlur={() => setDraft(null)}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      style={{ ...inputBase, textAlign: 'right' }}
    />
  );
};

// 行にリンクを張る／外すためのポップオーバー。
// ①別シート合計リンク（このシート以外の各シート合計）／②カテゴリ小計リンク（全カテゴリ小計）
// を一覧から選ぶ。現在リンク中なら解除ボタンを出す。
const LinkPicker = ({ item, currentSheetId, linkTargets, onSetRowLink, onClose }) => {
  const { sheetTargets = [], categoryTargets = [] } = linkTargets || {};
  // ①は自シート以外の合計のみ（自シート合計を自シート行へ引くのは無意味）
  const sheetOpts = sheetTargets.filter(s => s.id !== currentSheetId);
  const isLinked = item.linked_sheet_id != null || item.linked_category_item_id != null;

  const optStyle = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '4px 8px', border: 'none', background: 'transparent',
    cursor: 'pointer', fontSize: 12, color: COLORS.ink, borderRadius: 4,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  };
  const headStyle = {
    fontSize: 11, fontWeight: 'bold', color: COLORS.muted,
    padding: '4px 8px 2px', textTransform: 'none',
  };
  return (
    <div
      role="dialog"
      aria-label="行リンク設定"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: '100%',
        left: pt(-58),
        marginTop: 2,
        width: 260,
        maxHeight: 300,
        overflowY: 'auto',
        background: '#fff',
        border: `1px solid ${COLORS.dashed}`,
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
        zIndex: 20,
        padding: 4,
      }}
    >
      {isLinked && (
        <button type="button" style={{ ...optStyle, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onSetRowLink(item._uid, null, null); onClose(); }}>
          <Link2Off size={12} /> リンクを解除
        </button>
      )}
      <div style={headStyle}>① 別シート合計を引く</div>
      {sheetOpts.length === 0 && <div style={{ ...optStyle, color: COLORS.muted }}>他のシートがありません</div>}
      {sheetOpts.map(s => (
        <button key={`s-${s.id}`} type="button" style={{
          ...optStyle,
          ...(String(item.linked_sheet_id) === String(s.id) ? { background: COLORS.linkBg, fontWeight: 'bold' } : {}),
        }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onSetRowLink(item._uid, 'sheet', s.id); onClose(); }}>
          {s.title}　<span style={{ color: COLORS.muted }}>{fmt(s.total)}</span>
        </button>
      ))}
      <div style={headStyle}>② カテゴリ小計を引く</div>
      {categoryTargets.length === 0 && <div style={{ ...optStyle, color: COLORS.muted }}>工種がありません</div>}
      {categoryTargets.map(c => (
        <button key={`c-${c.ref}`} type="button" style={{
          ...optStyle,
          ...(String(item.linked_category_item_id) === String(c.ref) ? { background: COLORS.linkBg, fontWeight: 'bold' } : {}),
        }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onSetRowLink(item._uid, 'category', c.ref); onClose(); }}>
          {c.label}　<span style={{ color: COLORS.muted }}>{fmt(c.subtotal)}</span>
          {c.sheetTitle ? <span style={{ color: COLORS.muted, fontSize: 10 }}>（{c.sheetTitle}）</span> : ''}
        </button>
      ))}
    </div>
  );
};

// 行左端にホバーで出す行操作ツールバー（上下移動/追加/複製/削除/リンク）
const RowToolbar = ({ item, onAddRowAfter, onDuplicateRow, onRemoveRow, onMoveRow, onSetRowLink, currentSheetId, linkTargets }) => {
  const [linkOpen, setLinkOpen] = useState(false);
  const canLink = typeof onSetRowLink === 'function' && item.item_type === ITEM_TYPE.ITEM;
  const isLinked = item.linked_sheet_id != null || item.linked_category_item_id != null;
  const btn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, border: 'none', background: 'transparent',
    cursor: 'pointer', color: COLORS.muted, padding: 0,
  };
  return (
    <div
      className="sheet-row-toolbar"
      style={{
        position: 'absolute',
        top: '50%',
        left: pt(-58),
        transform: 'translateY(-50%)',
        display: 'flex',
        gap: 2,
        alignItems: 'center',
        background: '#fff',
        border: `1px solid ${COLORS.dashed}`,
        borderRadius: 4,
        padding: '1px 3px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        opacity: 0.35,
        pointerEvents: 'auto',
        transition: 'opacity 0.1s',
        zIndex: 5,
      }}
    >
      <button type="button" style={btn} title="上へ移動" aria-label="上へ移動"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onMoveRow(item._uid, 'up')}><ChevronUp size={12} /></button>
      <button type="button" style={btn} title="下へ移動" aria-label="下へ移動"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onMoveRow(item._uid, 'down')}><ChevronDown size={12} /></button>
      <button type="button" style={btn} title="下に行を追加" aria-label="下に行を追加"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAddRowAfter(item._uid, ITEM_TYPE.ITEM)}><Plus size={12} /></button>
      <button type="button" style={{ ...btn, color: '#2563eb' }} title="行を複製" aria-label="行を複製"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onDuplicateRow(item._uid)}><Copy size={12} /></button>
      {canLink && (
        <button type="button"
          style={{ ...btn, color: isLinked ? '#2563eb' : COLORS.muted }}
          title="他シート合計／カテゴリ小計をこの行に引く"
          aria-label="行にリンクを設定"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLinkOpen(o => !o)}><Link2 size={12} /></button>
      )}
      <button type="button" style={{ ...btn, color: '#dc2626' }} title="行を削除" aria-label="行を削除"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onRemoveRow(item._uid)}><Trash2 size={12} /></button>
      {canLink && linkOpen && (
        <LinkPicker
          item={item}
          currentSheetId={currentSheetId}
          linkTargets={linkTargets}
          onSetRowLink={onSetRowLink}
          onClose={() => setLinkOpen(false)}
        />
      )}
    </div>
  );
};

// ============================================================
// 行レンダリング
// ============================================================
// edit = 編集ハンドラ束（null なら読み取り専用）
const renderRow = (row, rowKey, { isLastRowOfPage, isSolidBottom, cycleUids }, edit) => {
  const rowStyle = {
    ...rowBase,
    ...(isSolidBottom || isLastRowOfPage ? { borderBottom: solidBottom } : {}),
  };

  const editable = !!edit;
  // 編集可能行（item/category/comment）にホバーツールバーを載せる
  const toolbar = editable && row.item ? (
    <RowToolbar
      item={row.item}
      onAddRowAfter={edit.onAddRowAfter}
      onDuplicateRow={edit.onDuplicateRow}
      onRemoveRow={edit.onRemoveRow}
      onMoveRow={edit.onMoveRow}
      onSetRowLink={edit.onSetRowLink}
      currentSheetId={edit.currentSheetId}
      linkTargets={edit.linkTargets}
    />
  ) : null;

  switch (row.kind) {
    case 'category': {
      const { item, catTotal } = row;
      const uid = item._uid;
      return (
        <div key={rowKey} className={editable ? 'sheet-edit-row' : undefined}
          style={{ ...rowStyle, background: COLORS.categoryBg }}>
          {toolbar}
          <div style={{ ...CELLS.no, borderRight: 'none' }}>
            {editable ? (
              <input
                type="text"
                data-uid={uid}
                data-col="category_symbol"
                value={item.category_symbol || ''}
                placeholder="A"
                onChange={(e) => edit.onUpdateItem(uid, 'category_symbol', e.target.value)}
                onKeyDown={edit.onKeyDown}
                style={{ ...inputBase, textAlign: 'center', fontWeight: 'bold' }}
              />
            ) : (item.category_symbol || '')}
          </div>
          <div style={{ ...CELLS.name, flex: 7, borderRight: 'none', fontWeight: 'bold' }}>
            {editable ? (
              <input
                type="text"
                data-uid={uid}
                data-col="name"
                value={item.name || ''}
                placeholder="工種名"
                onChange={(e) => edit.onUpdateItem(uid, 'name', e.target.value)}
                onKeyDown={edit.onKeyDown}
                style={{ ...inputBase, fontWeight: 'bold' }}
              />
            ) : (
              <>{item.category_symbol ? `${item.category_symbol}　` : ''}{item.name}</>
            )}
          </div>
          <div style={{ ...CELLS.amount, borderRight: 'none', fontWeight: 'bold' }}>
            {catTotal > 0 ? fmt(catTotal) : ''}
          </div>
          <div style={CELLS.note} />
        </div>
      );
    }
    case 'comment': {
      const { item } = row;
      const uid = item._uid;
      return (
        <div key={rowKey} className={editable ? 'sheet-edit-row' : undefined} style={rowStyle}>
          {toolbar}
          <div style={CELLS.no} />
          <div style={{ ...CELLS.name, flex: 5 }}>
            {editable ? (
              <TextCell uid={uid} col="name" value={item.name} italic color={COLORS.noteInk}
                placeholder="コメント" onChange={(c, v) => edit.onUpdateItem(uid, c, v)}
                onKeyDown={edit.onKeyDown} />
            ) : (item.name)}
          </div>
          <div style={CELLS.qty} />
          <div style={CELLS.unit} />
          <div style={CELLS.price} />
          <div style={CELLS.amount} />
          <div style={CELLS.note} />
        </div>
      );
    }
    case 'item': {
      const { item, itemNo } = row;
      const uid = item._uid;
      if (!editable) {
        return (
          <div key={rowKey} style={rowStyle}>
            <div style={CELLS.no}>{itemNo ?? ''}</div>
            <div style={CELLS.name}>{item.name}</div>
            <div style={CELLS.spec}>{item.spec || ''}</div>
            <div style={CELLS.qty}>{item.quantity != null && item.quantity !== '' ? Number(item.quantity).toLocaleString('ja-JP') : ''}</div>
            <div style={CELLS.unit}>{item.unit || ''}</div>
            <div style={CELLS.price}>{item.unit_price != null && item.unit_price !== '' ? fmt(item.unit_price) : ''}</div>
            <div style={CELLS.amount}>{item.amount != null && item.amount !== '' ? fmt(item.amount) : ''}</div>
            <div style={CELLS.note}>{item.note || ''}</div>
          </div>
        );
      }
      const chg = (col, val) => edit.onUpdateItem(uid, col, val);
      const paste = (e) => edit.onCellPaste(e, uid);
      // リンク行判定: ①別シート合計リンク / ②カテゴリ小計リンク。
      // リンクが制御する列（名称・数量・単位・単価・金額・摘要）はエンジンが毎描画で
      // 上書きするため、編集可能モードでも input を出さず解決値を静的表示する。
      const isLink1 = item.linked_sheet_id != null;
      const isLink2 = item.linked_category_item_id != null;
      const isCycle = cycleUids && cycleUids.has(uid);
      const linkRowStyle = (isLink1 || isLink2)
        ? { ...rowStyle, background: isCycle ? COLORS.cycleBg : COLORS.linkBg }
        : rowStyle;
      // ② はカテゴリ小計そのものなので名称・数量・単位・単価・金額すべてリンク制御。
      // ① はシート合計→単価なので単価・金額・摘要をリンク制御（名称・数量は手入力可）。
      const lockName = isLink2;
      const lockQty  = isLink2;
      const lockUnit = isLink2;
      const lockPrice = isLink1 || isLink2;
      const lockNote = isLink1;
      return (
        <div key={rowKey} className="sheet-edit-row" style={linkRowStyle} title={isCycle ? '循環参照のためリンクを無効化しています' : undefined}>
          {toolbar}
          <div style={CELLS.no}>{itemNo ?? ''}</div>
          <div style={CELLS.name}>
            {lockName
              ? item.name
              : <TextCell uid={uid} col="name" value={item.name} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          <div style={CELLS.spec}>
            <TextCell uid={uid} col="spec" value={item.spec} color={COLORS.subInk} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />
          </div>
          <div style={CELLS.qty}>
            {lockQty
              ? (item.quantity != null && item.quantity !== '' ? Number(item.quantity).toLocaleString('ja-JP') : '')
              : <NumberCell uid={uid} col="quantity" value={item.quantity} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          <div style={CELLS.unit}>
            {lockUnit
              ? (item.unit || '')
              : <TextCell uid={uid} col="unit" value={item.unit} align="center" onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          <div style={CELLS.price}>
            {lockPrice
              ? (item.unit_price != null && item.unit_price !== '' ? fmt(item.unit_price) : '')
              : <NumberCell uid={uid} col="unit_price" value={item.unit_price} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          {/* 金額は自動計算（数量×単価）だが非リンク行は手入力での上書きも許容。Tabナビ対象外 */}
          <div style={CELLS.amount}>
            {(lockPrice)
              ? (item.amount != null && item.amount !== '' ? fmt(item.amount) : '')
              : <NumberCell uid={uid} col="__amount" value={item.amount}
                  onChange={(_c, v) => edit.onUpdateItem(uid, 'amount', v)} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          <div style={CELLS.note}>
            {lockNote
              ? <span style={{ color: COLORS.noteInk }}>{item.note || ''}</span>
              : <TextCell uid={uid} col="note" value={item.note} color={COLORS.noteInk} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
        </div>
      );
    }
    case 'subtotal': {
      return (
        <div key={rowKey} style={{ ...rowStyle, borderBottom: solidBottom }}>
          <div style={CELLS.no} />
          <div style={{ ...CELLS.name, flex: 5, justifyContent: 'flex-end', fontWeight: 'bold', paddingRight: pt(8) }}>合　計</div>
          <div style={CELLS.qty} />
          <div style={CELLS.unit} />
          <div style={CELLS.price} />
          <div style={{ ...CELLS.amount, fontWeight: 'bold' }}>{fmt(row.item.amount)}</div>
          <div style={CELLS.note} />
        </div>
      );
    }
    case 'fixed': {
      const { item } = row;
      return (
        <div key={rowKey} style={{ ...rowStyle, background: COLORS.fixedBg }}>
          <div style={{ ...CELLS.no, borderRight: 'none' }} />
          <div style={{ ...CELLS.name, borderRight: 'none' }}>{item.name}</div>
          <div style={{ ...CELLS.spec, borderRight: 'none' }} />
          <div style={CELLS.qty}>1.0</div>
          <div style={CELLS.unit}>式</div>
          <div style={CELLS.price} />
          <div style={CELLS.amount}>{fmt(item.amount)}</div>
          <div style={CELLS.note} />
        </div>
      );
    }
    // トップシート末尾の「税抜合計」／サブシート末尾の「合　計」
    case 'total-ex-tax':
    case 'sheet-total': {
      const label = row.kind === 'total-ex-tax' ? '税抜合計' : '合　計';
      return (
        <div key={rowKey} style={{ ...rowStyle, borderBottom: solidBottom }}>
          <div style={{ ...CELLS.no, borderRight: 'none' }} />
          <div style={{ ...CELLS.name, borderRight: 'none' }} />
          <div style={{ ...CELLS.spec, borderRight: 'none' }} />
          <div style={{ ...CELLS.qty, borderRight: 'none' }} />
          <div style={{ ...CELLS.unit, borderRight: 'none' }} />
          <div style={{ ...CELLS.price, fontWeight: 'bold' }}>{label}</div>
          <div style={{ ...CELLS.amount, fontWeight: 'bold' }}>{fmt(row.amount)}</div>
          <div style={CELLS.note} />
        </div>
      );
    }
    case 'net': {
      return (
        <div key={rowKey} style={{
          ...rowStyle,
          borderBottom: solidBottom,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontSize: table.cellFontSize, fontWeight: 'bold', letterSpacing: pt(1) }}>
            【　NET金額　¥{fmt(row.amount)}-　】
          </span>
        </div>
      );
    }
    case 'dummy':
    default: {
      return (
        <div key={rowKey} style={rowStyle}>
          <div style={CELLS.no} />
          <div style={CELLS.name} />
          <div style={CELLS.spec} />
          <div style={CELLS.qty} />
          <div style={CELLS.unit} />
          <div style={CELLS.price} />
          <div style={CELLS.amount} />
          <div style={CELLS.note} />
        </div>
      );
    }
  }
};

// 列ヘッダー行
const HeaderRow = () => {
  const hCell = (style, label, noBorder = false) => (
    <div style={{
      ...style,
      justifyContent: 'center',
      fontWeight: 'bold',
      paddingTop: 0,
      paddingBottom: 0,
      ...(noBorder ? { borderRight: 'none' } : {}),
    }}>{label}</div>
  );
  return (
    <div style={{
      display: 'flex',
      height: table.headerHeight,
      boxSizing: 'border-box',
      background: COLORS.headerBg,
      border: `${pt(1)}px solid ${COLORS.ink}`,
    }}>
      {hCell(CELLS.no, 'No.')}
      {hCell(CELLS.name, '名　　　　　　称')}
      {hCell(CELLS.spec, '仕　　　　　　様')}
      {hCell(CELLS.qty, '数　量')}
      {hCell(CELLS.unit, '単位')}
      {hCell(CELLS.price, '単　価')}
      {hCell(CELLS.amount, '金　額')}
      {hCell(CELLS.note, '摘　要', true)}
    </div>
  );
};

// ============================================================
// 本体
// ============================================================
const SheetPaper = ({
  sheet,             // { id, title }
  sheetIndex,        // 0 = トップシート（総括表）
  items,             // このシートに属する明細（表示順。全 sheet_id === sheet.id）
  header,            // estimate_number / show_fixed_fees / show_net を参照
  settings,          // フッターの会社名表示用
  totals,            // calcTotals の結果（トップシートの税抜合計・NETに使用）
  sheetTotal,        // Phase 5: 計算エンジンが解決したこのシートの合計（サブシート合計に使用）
  cycleUids,         // Phase 5: 循環参照で無効化された行の _uid 集合（警告表示用）
  linkTargets,       // Phase 5: 行リンクピッカーの候補 { sheetTargets, categoryTargets }
  startPageNumber,   // このシート先頭ページの通し番号（鑑が No.1）
  // ── Phase 4: セル編集（すべて任意。未指定 or isLocked なら読み取り専用） ──
  isLocked,
  onUpdateItem,
  onAddRowAfter,
  onAddRowToSheet,
  onRemoveRow,
  onDuplicateRow,
  onMoveRow,
  onPasteTsv,
  onSetRowLink,      // Phase 5: 行にリンク①②を張る／外す
}) => {
  const isTopSheet = sheetIndex === 0;
  const rows = buildSheetRows(items, header, isTopSheet, totals, sheetTotal);
  const estimateNumber = `${header.estimate_number_date}-${header.estimate_number_seq}-${header.estimate_number_branch}`;

  const editable = !isLocked && typeof onUpdateItem === 'function';
  const sheetRef = useRef(null);
  // 追加行へフォーカスを移すため、末尾セル数を保持（追加後に navCells が伸びる）
  const prevNavCountRef = useRef(0);

  // このシート内の編集可能セルを (uid, col) の平坦な順序で列挙する。
  // Tab/Enter/矢印ナビはこのリスト上のインデックス移動として扱う。
  const navCells = [];
  if (editable) {
    items.forEach((item) => {
      if (!isNavigable(item.item_type)) return;
      colKeysFor(item).forEach((col) => navCells.push({ uid: item._uid, col }));
    });
  }

  const focusCell = useCallback((uid, col) => {
    // 描画反映後にフォーカスを移す（新規行追加直後などに対応）
    requestAnimationFrame(() => {
      sheetRef.current
        ?.querySelector(`[data-uid="${uid}"][data-col="${col}"]`)
        ?.focus();
    });
  }, []);

  // 末尾から次シート行追加 → 追加後の描画で最後の name セルへフォーカス
  const addRowAndFocus = useCallback(() => {
    prevNavCountRef.current = navCells.length;
    onAddRowToSheet(sheet.id, ITEM_TYPE.ITEM);
    // 追加された ITEM 行の name セルは navCells 末尾に来る。次フレームで取得。
    requestAnimationFrame(() => {
      const inputs = sheetRef.current?.querySelectorAll('input[data-col="name"]');
      const last = inputs && inputs.length ? inputs[inputs.length - 1] : null;
      last?.focus();
    });
  }, [navCells.length, onAddRowToSheet, sheet.id]);

  // Tab/Enter=次セル、Shift+Tab=前セル、矢印上下=同列の前後行セルへ。
  // 末尾セルで Tab/Enter を押したら新規 ITEM 行を追加してその name へ。
  const handleKeyDown = useCallback((e) => {
    if (!editable) return;
    // IME変換中は無視
    if (e.isComposing || e.nativeEvent?.isComposing) return;
    const uid = e.target.dataset?.uid;
    const col = e.target.dataset?.col;
    if (!uid || !col) return;

    const idx = navCells.findIndex((c) => c.uid === uid && c.col === col);
    if (idx < 0) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
      if (nextIdx < 0) return;
      if (nextIdx >= navCells.length) {
        addRowAndFocus();
        return;
      }
      const t = navCells[nextIdx];
      focusCell(t.uid, t.col);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const nextIdx = idx + 1;
      if (nextIdx >= navCells.length) {
        addRowAndFocus();
        return;
      }
      const t = navCells[nextIdx];
      focusCell(t.uid, t.col);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // 同じ列(col)を持つ前後の行のセルへ移動
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      for (let j = idx + dir; j >= 0 && j < navCells.length; j += dir) {
        if (navCells[j].col === col) {
          e.preventDefault();
          focusCell(navCells[j].uid, navCells[j].col);
          return;
        }
      }
    }
  }, [editable, navCells, focusCell, addRowAndFocus]);

  // セルへの TSV 貼り付け（複数行 or タブ区切りを含む場合のみ横取り）。
  // 単一値の貼り付けはブラウザ既定（当該セルへの通常貼付）に任せる。
  const handleCellPaste = useCallback((e, uid) => {
    if (!editable) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    onPasteTsv(uid, text);
  }, [editable, onPasteTsv]);

  const edit = editable ? {
    onUpdateItem,
    onAddRowAfter,
    onDuplicateRow,
    onRemoveRow,
    onMoveRow,
    onKeyDown: handleKeyDown,
    onCellPaste: handleCellPaste,
    onSetRowLink,
    currentSheetId: sheet.id,
    linkTargets,
  } : null;

  // 19行ずつページに分割
  const pages = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }

  return (
    <div
      ref={sheetRef}
      id={`paper-sheet-${sheetIndex}`}
      style={{ display: 'flex', flexDirection: 'column', gap: pt(18), alignItems: 'center' }}
    >
      {/* 行ツールバーは常時薄く表示し、ホバー/タップ時にはっきり表示するためのスタイル
          （タッチデバイスではホバーが効かないため、常時ある程度視認できるようにしている） */}
      <style>{`
        #paper-sheet-${sheetIndex} .sheet-edit-row:hover .sheet-row-toolbar,
        #paper-sheet-${sheetIndex} .sheet-edit-row:focus-within .sheet-row-toolbar { opacity: 1 !important; pointer-events: auto !important; }
      `}</style>
      {pages.map((pageRows, pageIdx) => (
        <div
          key={pageIdx}
          className="bg-white shadow-lg shrink-0"
          style={{
            width: PAPER_WIDTH,
            height: PAPER_HEIGHT,
            boxSizing: 'border-box',
            paddingTop: page.paddingTop,
            paddingBottom: page.paddingBottom,
            paddingLeft: page.paddingX,
            paddingRight: page.paddingX,
            fontSize: page.fontSize,
            color: COLORS.ink,
            position: 'relative',
          }}
        >
          {/* ページヘッダー（左上に見積番号、中央にシートタイトル） */}
          <div style={{ position: 'relative', marginBottom: pt(10) }}>
            <span style={{
              position: 'absolute',
              top: pt(5),
              left: 0,
              fontSize: table.sheetNoFontSize,
              color: COLORS.noteInk,
            }}>（{estimateNumber}）</span>
            <div style={{
              fontSize: table.sheetTitleFontSize,
              fontWeight: 'bold',
              textAlign: 'center',
            }}>{sheet.title || '見積内訳明細書'}</div>
          </div>

          <HeaderRow />

          {pageRows.map((row, rowIdx) => renderRow(row, rowIdx, {
            isLastRowOfPage: rowIdx === ROWS_PER_PAGE - 1,
            isSolidBottom: false,
            cycleUids,
          }, edit))}

          {/* 末尾ページに［＋行を追加］（編集時のみ） */}
          {editable && pageIdx === pages.length - 1 && (
            <button
              type="button"
              onClick={addRowAndFocus}
              style={{
                position: 'absolute',
                bottom: pt(30),
                left: page.paddingX,
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: pt(9), color: '#2563eb',
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              <Plus size={12} /> 行を追加
            </button>
          )}

          {/* ページフッター（会社名・通しページ番号） */}
          <div style={{
            position: 'absolute',
            bottom: pt(15),
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: table.footerFontSize,
            color: COLORS.muted,
          }}>{settings?.company_name || ''}</div>
          <div style={{
            position: 'absolute',
            bottom: pt(15),
            right: pt(40),
            fontSize: table.footerFontSize,
            color: COLORS.muted,
          }}>No.{startPageNumber + pageIdx}</div>
        </div>
      ))}
    </div>
  );
};

export default SheetPaper;
