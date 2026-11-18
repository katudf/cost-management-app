// src/estimate-editor/SheetPaper.jsx
// 明細シート1枚を紙面（A4横 1123×794px）そのままのレイアウトで表示する。
// 1シートが19行/ページを超える場合は複数ページに分割して縦に積む。
//
// 移植元: src/EstimatePDF.jsx の DetailPage（テーブル罫線・行高・ダミー行
// パディングのアルゴリズムは同一）。ただしフッター行の構成は新シートモデル
// （design.md §4）に合わせて変更している:
//   - トップシート(sheetIndex 0): 「税抜合計」1行 ＋ NET行(show_net時)。
//     消費税・税込合計は鑑側にのみ表示する。
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
import React, { useRef, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Copy, ChevronUp, ChevronDown, Link2, Link2Off, FolderPlus, MessageSquarePlus, Scissors, X, Percent } from 'lucide-react';
import { ITEM_TYPE } from '../utils/constants';
import { sumItemAmounts } from '../supabaseEstimates';
import {
  pt, PAPER_WIDTH, PAPER_HEIGHT, ROWS_PER_PAGE, COLORS, page, table, fmt,
} from './paperStyles';
import { buildSheetRowsShared } from './sheetRowLayout';
import { formatNumberInput, formatQuantityInput, parseNumberInput } from './numberInputFormat';
import { ROW_DRAG_TYPE, isRowDragEvent } from './rowBulkOps';
import { RANGE_COLS, rangeColOf } from './cellRangeOps';

// セル範囲選択の強調色
const RANGE_BG = 'rgba(37, 99, 235, 0.14)';
// 範囲選択の対象セル（外側の枠 div）に付ける目印と強調表示。rangeKeys は `${uid}:${col}` の集合
const rangeCell = (baseStyle, uid, col, rangeKeys) => {
  const on = !!rangeKeys && (col === '*'
    ? RANGE_COLS.some(c => rangeKeys.has(`${uid}:${c}`))
    : rangeKeys.has(`${uid}:${col}`));
  return {
    'data-cell-uid': uid,
    'data-cell-col': col === '*' ? 'name' : col,
    style: on ? { ...baseStyle, background: RANGE_BG } : baseStyle,
  };
};

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
// 行リスト構築（データ行＋ダミー行＋フッター行）
// ============================================================
// DetailPage のパディングアルゴリズムを踏襲: 最終ページの
// データ行＋フッター行が19行に満たない分をダミー行で埋め、
// フッター行が必ず最終ページ末尾に収まるようにする。
// 返り値は行記述子 {kind, item?, itemNo?, catTotal?, label?, amount?} の配列で、
// 長さは必ず ROWS_PER_PAGE の倍数になる。
// noLabelOf: 工種小計リンク行の No. に出す工種記号（buildLinkSymbolLabeler）。行数は変わらないのでページ数計算では省略可
export const buildSheetRows = (items, header, isTopSheet, totals, sheetTotal, showTotalRow = true, noLabelOf = null) =>
  buildSheetRowsShared(items, header, isTopSheet, totals, sheetTotal, showTotalRow, isBlankRow, ROWS_PER_PAGE, noLabelOf);

// シートが占めるページ数（EstimateEditor が通しページ番号を計算するのに使う）
export const calcSheetPageCount = (items, header, isTopSheet, totals, sheetTotal, showTotalRow = true) =>
  buildSheetRows(items, header, isTopSheet, totals, sheetTotal, showTotalRow).length / ROWS_PER_PAGE;

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
const NumberCell = ({ uid, col, value, format, onChange, onPaste, onKeyDown }) => {
  const [draft, setDraft] = useState(null);
  // この欄の入力で送った最後の値。これと違う値が来たら、範囲への貼り付け・消去や元に戻すなど
  // 外からの変更なので、入力中の表示（draft）もその値に合わせる
  const emittedRef = useRef(value);
  useEffect(() => {
    if (draft !== null && value !== emittedRef.current) {
      emittedRef.current = value;
      setDraft(String(value ?? ''));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmtFn = format || formatNumberInput;
  const displayValue = draft !== null ? draft : fmtFn(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      data-uid={uid}
      data-col={col}
      value={displayValue}
      onFocus={() => { emittedRef.current = value; setDraft(String(value ?? '')); }}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseNumberInput(e.target.value);
        emittedRef.current = parsed;
        onChange(col, parsed);
      }}
      onBlur={() => setDraft(null)}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      style={{ ...inputBase, textAlign: 'right' }}
    />
  );
};

// 単位欄の候補（EstimateItemTable.jsx より移植）
const UNIT_SUGGESTIONS = ['m²', 'm', 'm³', '本', '式', 'ヶ所', '個', 't', '枚', '組'];

// 単位入力欄（候補プルダウン付き）。
// フォーカスで候補を表示し、上下キーでハイライト移動、Enter/クリックで確定。
// 候補未選択時の Enter・Tab・上下キーは既存のセル間ナビゲーション(onKeyDown)に委ねる。
const UnitCell = ({ uid, col, value, onChange, onPaste, onKeyDown }) => {
  const [showSug, setShowSug] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [menuPos, setMenuPos] = useState(null);
  const inputRef = useRef(null);

  const openSug = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom, left: rect.left, minWidth: rect.width });
    setShowSug(true);
  };

  const commit = (unit) => {
    onChange(col, unit);
    setShowSug(false);
    setHighlightIdx(-1);
  };

  const handleKeyDown = (e) => {
    // Shift を押したら候補を閉じる（下のセルへの Shift+クリック・Shift+↑↓ での範囲選択を候補が奪わないように）
    if (e.key === 'Shift' && showSug) {
      setShowSug(false);
      setHighlightIdx(-1);
    }
    if (showSug && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setHighlightIdx((prev) => {
        const next = prev + dir;
        if (next < 0) return UNIT_SUGGESTIONS.length - 1;
        if (next >= UNIT_SUGGESTIONS.length) return 0;
        return next;
      });
      return;
    }
    if (showSug && e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      commit(UNIT_SUGGESTIONS[highlightIdx]);
      return;
    }
    if (showSug && e.key === 'Escape') {
      e.preventDefault();
      setShowSug(false);
      setHighlightIdx(-1);
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        data-uid={uid}
        data-col={col}
        value={value || ''}
        onChange={(e) => onChange(col, e.target.value)}
        onFocus={openSug}
        onBlur={() => setTimeout(() => { setShowSug(false); setHighlightIdx(-1); }, 150)}
        onPaste={onPaste}
        onKeyDown={handleKeyDown}
        style={{ ...inputBase, textAlign: 'center' }}
      />
      {showSug && menuPos && createPortal(
        <div
          role="listbox"
          aria-label="単位候補"
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            marginTop: 2,
            minWidth: Math.max(menuPos.minWidth, 60),
            maxHeight: 220,
            overflowY: 'auto',
            background: '#fff',
            border: `1px solid ${COLORS.dashed}`,
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10000,
          }}
        >
          {UNIT_SUGGESTIONS.map((u, i) => (
            <button
              key={u}
              type="button"
              onMouseDown={(e) => {
                if (forwardShiftClickToCell(e)) { setShowSug(false); setHighlightIdx(-1); return; }
                commit(u);
              }}
              onMouseEnter={() => setHighlightIdx(i)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'center',
                padding: '4px 10px',
                border: 'none',
                background: i === highlightIdx ? COLORS.dashed : 'transparent',
                cursor: 'pointer',
                fontSize: table.cellFontSize,
                color: COLORS.ink,
                whiteSpace: 'nowrap',
              }}
            >
              {u}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

// 候補リストの上での Shift+クリックは候補を確定せず、リストの下にある明細セルへの
// Shift+クリック（範囲選択）として渡し直す。渡せたら true
const forwardShiftClickToCell = (e) => {
  if (!e.shiftKey) return false;
  // 元のクリックは候補リスト（セル以外）なので、そのまま伝わると範囲の解除になる
  e.preventDefault(); // 候補ボタンへフォーカスを移さない（入力中のセルにカーソルを残す）
  e.stopPropagation();
  // 候補リストのすぐ下にある要素だけを見る（全画面表示の裏にある通常表示のセルは拾わない）。
  // 候補リストは body 直下に出すので、シートは入力中のセル（フォーカスは残っている）から求める
  const list = e.currentTarget.parentElement;
  const sheet = document.activeElement?.closest?.('[id^="paper-sheet-"]');
  const below = document.elementsFromPoint(e.clientX, e.clientY).find(el => !list?.contains(el));
  const cell = below?.closest?.('[data-cell-uid]');
  if (!cell || !sheet?.contains(cell)) return true; // 下にセルが無くても、候補は確定しない
  cell.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, button: 0, buttons: 1, shiftKey: true,
    clientX: e.clientX, clientY: e.clientY,
  }));
  return true;
};

// 品名入力欄（過去の見積明細からの候補付き）。
// 2文字以上入力して0.3秒止まると候補を検索し、品名・仕様・単位・単価と使用回数・最終使用日を出す。
// 上下キーで選択、Enter/クリックで確定（onPick で仕様・単位・単価まで反映）、Esc で閉じる。
// 候補が開いていないときの Enter・Tab・上下キーは、従来どおりセル間の移動。
const SUGGEST_MIN_CHARS = 2;
const SUGGEST_DELAY_MS = 300;
const yen = (v) => (v == null || v === '' ? '' : `¥${Number(v).toLocaleString('ja-JP')}`);

const NameCell = ({ uid, col, value, onChange, onPaste, onKeyDown, onSearch, onPick }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [menuPos, setMenuPos] = useState(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const seqRef = useRef(0); // 古い検索結果で上書きしないための通し番号
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const close = () => {
    clearTimeout(timerRef.current);
    seqRef.current += 1;
    setOpen(false);
    setHighlightIdx(-1);
  };

  const scheduleSearch = (text) => {
    clearTimeout(timerRef.current);
    const q = (text || '').trim();
    if (!onSearch || q.length < SUGGEST_MIN_CHARS) { close(); return; }
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      const list = await onSearch(q);
      if (seq !== seqRef.current) return;
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ top: rect.bottom, left: rect.left, minWidth: rect.width });
      setSuggestions(list || []);
      setHighlightIdx(-1);
      setOpen((list || []).length > 0 && document.activeElement === inputRef.current);
    }, SUGGEST_DELAY_MS);
  };

  const pick = (s) => {
    close();
    onPick?.(s);
  };

  const handleKeyDown = (e) => {
    // Shift を押したら候補を閉じる（範囲選択の Shift+クリック・Shift+↑↓ を候補が奪わないように）
    if (e.key === 'Shift' && open) close();
    if (open && !e.nativeEvent?.isComposing) {
      if (!e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setHighlightIdx((prev) => {
          const next = prev + dir;
          if (next < 0) return suggestions.length - 1;
          if (next >= suggestions.length) return 0;
          return next;
        });
        return;
      }
      if (e.key === 'Enter' && highlightIdx >= 0) {
        e.preventDefault();
        pick(suggestions[highlightIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 全画面表示を閉じる Esc より先に候補だけ閉じる
        close();
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        data-uid={uid}
        data-col={col}
        value={value || ''}
        autoComplete="off"
        onChange={(e) => { onChange(col, e.target.value); scheduleSearch(e.target.value); }}
        onBlur={() => setTimeout(close, 150)}
        onPaste={onPaste}
        onKeyDown={handleKeyDown}
        style={inputBase}
      />
      {open && menuPos && createPortal(
        <div
          role="listbox"
          aria-label="過去の見積からの品名候補"
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            marginTop: 2,
            minWidth: Math.max(menuPos.minWidth, 320),
            maxWidth: 480,
            maxHeight: 280,
            overflowY: 'auto',
            background: '#fff',
            border: `1px solid ${COLORS.dashed}`,
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10000,
          }}
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.name}|${s.spec}|${s.unit}`}
              type="button"
              role="option"
              aria-selected={i === highlightIdx}
              onMouseDown={(e) => {
                if (forwardShiftClickToCell(e)) { close(); return; }
                pick(s);
              }}
              onMouseEnter={() => setHighlightIdx(i)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '4px 8px',
                border: 'none',
                borderBottom: `1px solid ${COLORS.dashed}`,
                background: i === highlightIdx ? '#eff6ff' : 'transparent',
                cursor: 'pointer',
                color: COLORS.ink,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
                <span style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {yen(s.unit_price)}{s.unit ? ` / ${s.unit}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: COLORS.muted }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.spec || '（仕様なし）'}</span>
                <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {s.use_count}回{s.last_used ? `・最終 ${s.last_used}` : ''}
                </span>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
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
        top: `calc(50% - ${table.rowHeight}px)`,
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
        opacity: 0,
        pointerEvents: 'none',
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
      <button type="button" style={btn} title="下にグループ行を追加" aria-label="下にグループ行を追加"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAddRowAfter(item._uid, ITEM_TYPE.CATEGORY)}><FolderPlus size={12} /></button>
      <button type="button" style={btn} title="下にコメント行を追加" aria-label="下にコメント行を追加"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAddRowAfter(item._uid, ITEM_TYPE.COMMENT)}><MessageSquarePlus size={12} /></button>
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
// 複数行選択: 行の左端の選択つまみ・選択中の色・選択範囲のそばの操作バー
// ============================================================
const SelectionBar = ({ actions }) => {
  const btn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, border: 'none', background: 'transparent',
    cursor: 'pointer', color: '#334155', padding: 0, borderRadius: 4,
  };
  const keep = (e) => e.preventDefault(); // 押しても選択つまみのフォーカスを奪わない
  return (
    <div
      role="toolbar"
      aria-label="選択した行の操作"
      style={{
        position: 'absolute', right: 0, bottom: '100%', marginBottom: 2,
        display: 'flex', alignItems: 'center', gap: 2,
        background: '#fff', border: '1px solid #93c5fd', borderRadius: 6,
        padding: '2px 4px', boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        fontSize: 11, color: '#1d4ed8', zIndex: 7, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontWeight: 'bold', padding: '0 4px' }}>{actions.count}行選択中</span>
      <button type="button" style={btn} onMouseDown={keep} onClick={() => actions.onMove('up')}
        title="選択した行を上へ（Alt+↑）" aria-label="選択した行を上へ移動"><ChevronUp size={14} /></button>
      <button type="button" style={btn} onMouseDown={keep} onClick={() => actions.onMove('down')}
        title="選択した行を下へ（Alt+↓）" aria-label="選択した行を下へ移動"><ChevronDown size={14} /></button>
      <button type="button" style={btn} onMouseDown={keep} onClick={actions.onDuplicate}
        title="選択した行を複製" aria-label="選択した行を複製"><Plus size={14} /></button>
      <button type="button" style={btn} onMouseDown={keep} onClick={actions.onCopy}
        title="コピー（Ctrl+C）。Ctrl+V で選択行の下に貼り付け" aria-label="選択した行をコピー"><Copy size={14} /></button>
      <button type="button" style={btn} onMouseDown={keep} onClick={actions.onCut}
        title="切り取り（Ctrl+X）" aria-label="選択した行を切り取り"><Scissors size={14} /></button>
      {actions.onAdjustPrice && (
        <button type="button" style={btn} onMouseDown={keep} onClick={actions.onAdjustPrice}
          title="選択した行の単価を一括調整（掛率）" aria-label="選択した行の単価を一括調整"><Percent size={14} /></button>
      )}
      <button type="button" style={{ ...btn, color: '#dc2626' }} onMouseDown={keep} onClick={actions.onDelete}
        title="選択した行を削除（Delete）" aria-label="選択した行を削除"><Trash2 size={14} /></button>
      <button type="button" style={{ ...btn, color: '#64748b' }} onMouseDown={keep} onClick={actions.onClear}
        title="選択を解除（Esc）" aria-label="選択を解除"><X size={14} /></button>
    </div>
  );
};

// 行の飾り（選択つまみ・選択中の色・先頭の選択行には操作バー）。編集可能な行にだけ付ける
const rowSelectionDecor = (item, edit, selection, dropLine) => {
  if (!edit || !edit.onSelectRow) return null;
  const uid = item._uid;
  const selected = selection?.uids?.has(uid);
  const dropHere = dropLine && dropLine.uid === uid ? dropLine.position : null;
  return (
    <>
      <button
        type="button"
        className="sheet-row-handle"
        data-selected={selected ? 'true' : undefined}
        title="クリックで行を選択（Shift: 範囲／Ctrl: 追加・解除）。ドラッグで移動"
        aria-label="行を選択"
        aria-pressed={!!selected}
        draggable={!!edit.onRowDragStart}
        onDragStart={(e) => {
          if (!edit.onRowDragStart?.(uid)) { e.preventDefault(); return; }
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(ROW_DRAG_TYPE, uid);
        }}
        onDragEnd={() => edit.onRowDragEnd?.()}
        onClick={(e) => {
          // Shift+クリックでページ上の文字が選択されると Ctrl+C が文字のコピーになるため外す
          window.getSelection?.()?.removeAllRanges();
          edit.onSelectRow(uid, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
          // キー操作（Delete・Ctrl+C など）を受けられるよう、つまみにフォーカスを置く
          e.currentTarget.focus();
        }}
        style={{
          position: 'absolute', left: -pt(14), top: 0, bottom: 0, width: pt(10),
          padding: 0, border: 'none', borderRadius: 2, cursor: 'grab', userSelect: 'none',
          background: selected ? '#2563eb' : '#cbd5e1',
          opacity: selected ? 1 : 0, transition: 'opacity 0.1s', zIndex: 4,
        }}
      />
      {selected && (
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, background: 'rgba(37,99,235,0.12)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      )}
      {selected && selection.firstUid === uid && selection.actions && (
        <SelectionBar actions={selection.actions} />
      )}
      {/* ドラッグ中の落とし先（行の上端または下端の青線） */}
      {dropHere && (
        <div aria-hidden="true" style={{
          position: 'absolute', left: -pt(14), right: 0, height: 3,
          ...(dropHere === 'before' ? { top: -2 } : { bottom: -2 }),
          background: '#2563eb', borderRadius: 2, pointerEvents: 'none', zIndex: 8,
        }} />
      )}
    </>
  );
};

// ============================================================
// 行レンダリング
// ============================================================
// edit = 編集ハンドラ束（null なら読み取り専用）
const renderRow = (row, rowKey, { isLastRowOfPage, isSolidBottom, cycleUids, selection, dropLine, rangeKeys }, edit) => {
  const rowStyle = {
    ...rowBase,
    ...(isSolidBottom || isLastRowOfPage ? { borderBottom: solidBottom } : {}),
  };

  const editable = !!edit;
  // 編集可能行（item/category/comment）にホバーツールバーを載せる
  const decor = editable && row.item ? rowSelectionDecor(row.item, edit, selection, dropLine) : null;
  // ドラッグの落とし先判定に使う行の識別子（編集可能な行のみ）
  const rowUidAttr = editable && row.item ? { 'data-row-uid': row.item._uid } : {};
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
        <div key={rowKey} className={editable ? 'sheet-edit-row' : undefined} {...rowUidAttr}
          style={{ ...rowStyle, background: COLORS.categoryBg }}>
          {toolbar}
          {decor}
          <div {...(editable ? rangeCell({ ...CELLS.no, borderRight: 'none' }, uid, '*', rangeKeys) : { style: { ...CELLS.no, borderRight: 'none' } })}>
            {editable ? (
              <input
                type="text"
                data-uid={uid}
                data-col="category_symbol"
                value={item.category_symbol || ''}
                placeholder="A"
                onChange={(e) => edit.onUpdateItem(uid, 'category_symbol', e.target.value)}
                onPaste={(e) => edit.onCellPaste(e, uid, true)}
                onKeyDown={edit.onKeyDown}
                style={{ ...inputBase, textAlign: 'center', fontWeight: 'bold' }}
              />
            ) : (item.category_symbol || '')}
          </div>
          <div {...(editable ? rangeCell({ ...CELLS.name, flex: 7, borderRight: 'none', fontWeight: 'bold' }, uid, '*', rangeKeys) : { style: { ...CELLS.name, flex: 7, borderRight: 'none', fontWeight: 'bold' } })}>
            {editable ? (
              <input
                type="text"
                data-uid={uid}
                data-col="name"
                value={item.name || ''}
                placeholder="工種名"
                onChange={(e) => edit.onUpdateItem(uid, 'name', e.target.value)}
                onPaste={(e) => edit.onCellPaste(e, uid, true)}
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
        <div key={rowKey} className={editable ? 'sheet-edit-row' : undefined} {...rowUidAttr} style={rowStyle}>
          {toolbar}
          {decor}
          <div style={CELLS.no} />
          <div {...(editable ? rangeCell({ ...CELLS.name, flex: 1, borderRight: 'none' }, uid, '*', rangeKeys) : { style: { ...CELLS.name, flex: 1, borderRight: 'none' } })}>
            {editable ? (
              <TextCell uid={uid} col="name" value={item.name} italic color={COLORS.noteInk}
                placeholder="コメント" onChange={(c, v) => edit.onUpdateItem(uid, c, v)}
                onPaste={(e) => edit.onCellPaste(e, uid, true)}
                onKeyDown={edit.onKeyDown} />
            ) : (item.name)}
          </div>
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
            <div style={CELLS.qty}>{item.quantity != null && item.quantity !== '' ? formatQuantityInput(item.quantity) : ''}</div>
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
        <div key={rowKey} className="sheet-edit-row" {...rowUidAttr} style={linkRowStyle} title={isCycle ? '循環参照のためリンクを無効化しています' : undefined}>
          {toolbar}
          {decor}
          <div style={CELLS.no}>{itemNo ?? ''}</div>
          <div {...rangeCell(CELLS.name, uid, 'name', rangeKeys)}>
            {lockName
              ? item.name
              : <NameCell uid={uid} col="name" value={item.name} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown}
                  onSearch={edit.onSearchItemSuggestions}
                  onPick={edit.onPickItemSuggestion ? (s) => edit.onPickItemSuggestion(uid, s) : undefined} />}
          </div>
          <div {...rangeCell(CELLS.spec, uid, 'spec', rangeKeys)}>
            <TextCell uid={uid} col="spec" value={item.spec} color={COLORS.subInk} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />
          </div>
          <div {...rangeCell(CELLS.qty, uid, 'quantity', rangeKeys)}>
            {lockQty
              ? (item.quantity != null && item.quantity !== '' ? formatQuantityInput(item.quantity) : '')
              : <NumberCell uid={uid} col="quantity" value={item.quantity} format={formatQuantityInput} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          <div {...rangeCell(CELLS.unit, uid, 'unit', rangeKeys)}>
            {lockUnit
              ? (item.unit || '')
              : <UnitCell uid={uid} col="unit" value={item.unit} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          <div {...rangeCell(CELLS.price, uid, 'unit_price', rangeKeys)}>
            {lockPrice
              ? (item.unit_price != null && item.unit_price !== '' ? fmt(item.unit_price) : '')
              : <NumberCell uid={uid} col="unit_price" value={item.unit_price} onChange={chg} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          {/* 金額は自動計算（数量×単価）だが非リンク行は手入力での上書きも許容。Tabナビ対象外 */}
          <div {...rangeCell(CELLS.amount, uid, 'amount', rangeKeys)}>
            {(lockPrice)
              ? (item.amount != null && item.amount !== '' ? fmt(item.amount) : '')
              : <NumberCell uid={uid} col="__amount" value={item.amount}
                  onChange={(_c, v) => edit.onUpdateItem(uid, 'amount', v)} onPaste={paste} onKeyDown={edit.onKeyDown} />}
          </div>
          <div {...rangeCell(CELLS.note, uid, 'note', rangeKeys)}>
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
  header,            // estimate_number / show_net を参照
  settings,          // フッターの会社名表示用
  totals,            // calcTotals の結果（トップシートの税抜合計・NETに使用）
  sheetTotal,        // Phase 5: 計算エンジンが解決したこのシートの合計（サブシート合計に使用）
  showTotalRow = true, // サブシートの「合計」行を表示するか（他シートから参照されていない中間シートは非表示）
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
  // ── 複数行選択（任意） ──
  selectedUids,      // このシートで選択中の行 _uid の Set
  onSelectRow,       // (uid, { shift, ctrl }) => void  行の左端クリック
  onPasteRows,       // (uid, { html, text }) => boolean  アプリでコピーした行ならその行の下へ挿入して true
  selectionActions,  // 操作バーのハンドラ { count, onDelete, onDuplicate, onCopy, onCut, onMove, onClear, onAdjustPrice } | null
  // ── 行のドラッグ移動（任意） ──
  onRowDragStart,    // (uid) => boolean  ドラッグを始めてよければ true
  onRowDragOver,     // ({ sheetId, uid, position }) => void  落とし先の更新（uid null はシート末尾）
  onRowDrop,         // ({ sheetId, uid, position }) => void
  onRowDragEnd,      // () => void
  dropIndicator,     // このシート上の落とし先 { sheetId, uid, position } | null
  // ── 品名の入力補完（任意） ──
  onSearchItemSuggestions, // (query) => Promise<候補[]>  過去の見積明細からの候補
  onPickItemSuggestion,    // (uid, 候補) => void  品名・仕様・単位・単価を反映
  // ── No. の表示（任意） ──
  noLabelOf,         // (item) => string|null  工種小計リンク行の No. に出す工種記号
  // ── セルの範囲選択（任意） ──
  cellRangeKeys,     // このシートで範囲に入っているセル `${uid}:${col}` の Set
  onCellRangeSet,    // (anchor|null, focus) => void  範囲の両端（anchor null は今の範囲のアンカーのまま）
  onCellRangeStep,   // (from, dir) => void  Shift+↑↓ で先端を上下へ
  onCellRangeClear,  // () => void
  onCellRangeDelete, // () => void | null  範囲の消去（このシートに範囲があるときだけ）
  onCellRangePaste,  // (text) => boolean | null  範囲への貼り付け
}) => {
  const isTopSheet = sheetIndex === 0;
  const rows = buildSheetRows(items, header, isTopSheet, totals, sheetTotal, showTotalRow, noLabelOf);
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

  // 末尾にグループ(工種)行を追加 → 追加後の描画で最後の name セルへフォーカス
  const addGroupRowAndFocus = useCallback(() => {
    prevNavCountRef.current = navCells.length;
    onAddRowToSheet(sheet.id, ITEM_TYPE.CATEGORY);
    requestAnimationFrame(() => {
      const inputs = sheetRef.current?.querySelectorAll('input[data-col="name"]');
      const last = inputs && inputs.length ? inputs[inputs.length - 1] : null;
      last?.focus();
    });
  }, [navCells.length, onAddRowToSheet, sheet.id]);

  // 末尾にコメント行を追加 → 追加後の描画で最後の name セルへフォーカス
  const addCommentRowAndFocus = useCallback(() => {
    prevNavCountRef.current = navCells.length;
    onAddRowToSheet(sheet.id, ITEM_TYPE.COMMENT);
    requestAnimationFrame(() => {
      const inputs = sheetRef.current?.querySelectorAll('input[data-col="name"]');
      const last = inputs && inputs.length ? inputs[inputs.length - 1] : null;
      last?.focus();
    });
  }, [navCells.length, onAddRowToSheet, sheet.id]);

  // Tab/Enter=次セル、Shift+Tab=前セル、矢印上下=同列の前後行セルへ。
  // 末尾セルで Tab/Enter を押したら新規 ITEM 行を追加してその name へ。
  const rangeActive = editable && !!cellRangeKeys && cellRangeKeys.size > 0;

  const handleKeyDown = useCallback((e) => {
    if (!editable) return;
    // IME変換中は無視
    if (e.isComposing || e.nativeEvent?.isComposing) return;
    const uid = e.target.dataset?.uid;
    const col = e.target.dataset?.col;
    if (!uid || !col) return;

    // ── セルの範囲選択 ──
    // Shift+↑↓: 範囲を上下へ広げる（文字選択に使う Shift+←→ はそのまま）
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const rcol = rangeColOf(col);
      if (rcol && onCellRangeStep) {
        e.preventDefault();
        onCellRangeStep({ uid, col: rcol }, e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
    }
    if (rangeActive) {
      if (e.key === 'Escape') {
        // 全画面表示を閉じる Esc より先に、範囲の解除だけを行う
        e.preventDefault();
        e.stopPropagation();
        onCellRangeClear?.();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && onCellRangeDelete) {
        e.preventDefault();
        onCellRangeDelete();
        return;
      }
      // Ctrl/⌘ との組み合わせ（コピー・貼り付け・元に戻す等）と修飾キー単独は範囲を保つ。
      // それ以外（文字の入力・IME開始・移動キー）は範囲を解除して通常どおり処理する
      const modifierOnly = ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key);
      if (!modifierOnly && !e.ctrlKey && !e.metaKey) onCellRangeClear?.();
    }

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
  }, [editable, navCells, focusCell, addRowAndFocus, rangeActive, onCellRangeStep, onCellRangeClear, onCellRangeDelete]);

  // セルへの貼り付け。
  //   1) この画面でコピーした行（工種行・コメント行・リンクを含む）→ その行の下に行ごと挿入
  //   2) セルの範囲を選んでいる → 範囲へ貼り付け（1つの値なら範囲全体、複数セルなら左上から範囲内だけ）
  //   3) 複数行 or タブ区切り → カーソルのある列から流し込み（行が足りなければ追加）
  //   単一値はブラウザ既定（当該セルへの通常貼付）に任せる。
  // rangeOnly=true（工種行・コメント行）は 3) を行わない。
  const handleCellPaste = useCallback((e, uid, rangeOnly = false) => {
    if (!editable) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const html = e.clipboardData?.getData('text/html') ?? '';
    if (onPasteRows && onPasteRows(uid, { html, text })) {
      e.preventDefault();
      return;
    }
    if (rangeActive && onCellRangePaste) {
      if (onCellRangePaste(text)) e.preventDefault();
      return;
    }
    if (rangeOnly) return;
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    onPasteTsv(uid, text, e.target?.dataset?.col);
  }, [editable, onPasteTsv, onPasteRows, rangeActive, onCellRangePaste]);

  // ── マウスでの範囲選択 ──
  // Shift+クリック: 今のカーソル位置（範囲があればそのアンカー）からクリックしたセルまで。
  // ドラッグ: 押したセルから別のセルへ動いたら範囲に切り替える（同じセル内のドラッグは文字選択のまま）。
  const rangeDragRef = useRef(null); // { uid, col, last } 押したセル
  const cellOf = (el) => {
    const cell = el instanceof Element ? el.closest('[data-cell-uid]') : null;
    if (!cell || !sheetRef.current?.contains(cell)) return null;
    return { uid: cell.getAttribute('data-cell-uid'), col: cell.getAttribute('data-cell-col') };
  };
  const handleSheetMouseDown = (e) => {
    if (!editable || !onCellRangeSet || e.button !== 0) return;
    const cell = cellOf(e.target);
    if (!cell) return;
    if (e.shiftKey) {
      e.preventDefault(); // フォーカス移動と文字選択をさせない
      let anchor = null;
      if (!rangeActive) {
        const a = document.activeElement;
        const rcol = a?.dataset?.col ? rangeColOf(a.dataset.col) : null;
        anchor = a?.dataset?.uid && rcol && sheetRef.current?.contains(a) ? { uid: a.dataset.uid, col: rcol } : cell;
      }
      onCellRangeSet(anchor, cell);
      return;
    }
    rangeDragRef.current = { ...cell, last: null };
    if (rangeActive) onCellRangeClear?.();
  };
  useEffect(() => {
    if (!editable || !onCellRangeSet) return undefined;
    const onMove = (e) => {
      const drag = rangeDragRef.current;
      if (!drag) return;
      if (!(e.buttons & 1)) { rangeDragRef.current = null; return; }
      const cell = cellOf(document.elementFromPoint(e.clientX, e.clientY));
      if (!cell) return;
      const key = `${cell.uid}:${cell.col}`;
      if (drag.last === key) return;
      if (drag.last === null && cell.uid === drag.uid && cell.col === drag.col) return;
      drag.last = key;
      onCellRangeSet({ uid: drag.uid, col: drag.col }, cell);
      window.getSelection?.()?.removeAllRanges();
    };
    const onUp = () => { rangeDragRef.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [editable, onCellRangeSet]);

  const edit = editable ? {
    onUpdateItem,
    onAddRowAfter,
    onDuplicateRow,
    // 選択中の行の削除ボタンは、Delete キーと同じく選択した行をまとめて削除する
    onRemoveRow: (uid) => {
      if (selectionActions?.onDelete && selectedUids?.has(uid)) selectionActions.onDelete();
      else onRemoveRow(uid);
    },
    onMoveRow,
    onKeyDown: handleKeyDown,
    onCellPaste: handleCellPaste,
    onSetRowLink,
    onSelectRow,
    onRowDragStart,
    onRowDragEnd,
    onSearchItemSuggestions,
    onPickItemSuggestion,
    currentSheetId: sheet.id,
    linkTargets,
  } : null;

  // 選択中の行（先頭の選択行に操作バーを出す）
  const selection = editable && selectedUids && selectedUids.size > 0 ? {
    uids: selectedUids,
    firstUid: items.find(it => selectedUids.has(it._uid))?._uid ?? null,
    actions: selectionActions,
  } : null;

  // ドラッグの落とし先: 行の上半分ならその行の前、下半分なら後ろ。行以外（空き行・合計欄など）はシート末尾
  const dropTargetFromEvent = (e) => {
    const rowEl = e.target instanceof Element ? e.target.closest('[data-row-uid]') : null;
    if (rowEl && sheetRef.current?.contains(rowEl)) {
      const rect = rowEl.getBoundingClientRect();
      return {
        sheetId: sheet.id,
        uid: rowEl.getAttribute('data-row-uid'),
        position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
      };
    }
    return { sheetId: sheet.id, uid: null, position: 'after' };
  };
  const canDrop = (e) => editable && typeof onRowDrop === 'function' && isRowDragEvent(e);
  const handleSheetDragOver = (e) => {
    if (!canDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onRowDragOver?.(dropTargetFromEvent(e));
  };
  const handleSheetDrop = (e) => {
    if (!canDrop(e)) return;
    e.preventDefault();
    onRowDrop(dropTargetFromEvent(e));
  };
  // 青線を出す位置（シート末尾は最後の行の下）
  const lastItemUid = items.length ? items[items.length - 1]._uid : null;
  const dropLine = dropIndicator
    ? (dropIndicator.uid ? dropIndicator : { uid: lastItemUid, position: 'after' })
    : null;

  // 19行ずつページに分割
  const pages = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }

  return (
    <div
      ref={sheetRef}
      id={`paper-sheet-${sheetIndex}`}
      onDragOver={handleSheetDragOver}
      onDrop={handleSheetDrop}
      onMouseDown={handleSheetMouseDown}
      style={{ display: 'flex', flexDirection: 'column', gap: pt(18), alignItems: 'center' }}
    >
      {/* 行ツールバーは通常非表示、アクティブ（フォーカス中）の行のみ表示するためのスタイル */}
      <style>{`
        #paper-sheet-${sheetIndex} .sheet-edit-row:focus-within .sheet-row-toolbar { opacity: 1 !important; pointer-events: auto !important; }
        #paper-sheet-${sheetIndex} .sheet-edit-row:hover .sheet-row-handle { opacity: 1 !important; }
        #paper-sheet-${sheetIndex} .sheet-row-handle:focus-visible { opacity: 1 !important; outline: 2px solid #1d4ed8; }
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

          {/* 明細行は _uid を key にする（行の移動後もフォーカスや入力中の値が同じ行に付いて動くように） */}
          {pageRows.map((row, rowIdx) => renderRow(row, row.item?._uid ? `${row.kind}:${row.item._uid}` : `pos-${rowIdx}`, {
            isLastRowOfPage: rowIdx === ROWS_PER_PAGE - 1,
            isSolidBottom: false,
            cycleUids,
            selection,
            dropLine,
            rangeKeys: editable ? cellRangeKeys : null,
          }, edit))}

          {/* 末尾ページに［＋行を追加］［＋グループ行を追加］［＋コメント行を追加］（編集時のみ） */}
          {editable && pageIdx === pages.length - 1 && (
            <>
              <button
                type="button"
                onClick={addRowAndFocus}
                aria-label="行を追加"
                title="行を追加"
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
              <button
                type="button"
                onClick={addGroupRowAndFocus}
                aria-label="グループ行を追加"
                title="グループ行を追加"
                style={{
                  position: 'absolute',
                  bottom: pt(30),
                  left: page.paddingX + pt(70),
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: pt(9), color: '#2563eb',
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                }}
              >
                <FolderPlus size={12} /> グループ行を追加
              </button>
              <button
                type="button"
                onClick={addCommentRowAndFocus}
                aria-label="コメント行を追加"
                title="コメント行を追加"
                style={{
                  position: 'absolute',
                  bottom: pt(30),
                  left: page.paddingX + pt(160),
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: pt(9), color: '#2563eb',
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                }}
              >
                <MessageSquarePlus size={12} /> コメント行を追加
              </button>
            </>
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
