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
// Phase 3 では読み取り専用（セル編集は Phase 4 で実装）。
import React from 'react';
import { ITEM_TYPE } from '../utils/constants';
import {
  pt, PAPER_WIDTH, PAPER_HEIGHT, ROWS_PER_PAGE, COLORS, page, table, fmt,
} from './paperStyles';

// 空行センチネル（design.md §4: 空行は保持し、category_symbol で識別する）
const BLANK_SENTINEL = '__blank__';

const isBlankRow = (item) =>
  item.category_symbol === BLANK_SENTINEL &&
  !item.name && !item.spec &&
  item.quantity == null && item.unit_price == null;

// ============================================================
// 行リスト構築（データ行＋ダミー行＋フッター行）
// ============================================================
// DetailPage のパディングアルゴリズムを踏襲: 最終ページの
// データ行＋フッター行が19行に満たない分をダミー行で埋め、
// フッター行が必ず最終ページ末尾に収まるようにする。
// 返り値は行記述子 {kind, item?, itemNo?, catTotal?, label?, amount?} の配列で、
// 長さは必ず ROWS_PER_PAGE の倍数になる。
export const buildSheetRows = (items, header, isTopSheet, totals) => {
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
      // 空行はNo.を振らず空欄のまま印字する
      rows.push({ kind: 'blank', item });
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
    const sheetTotal = items.reduce(
      (sum, i) => sum + (i.item_type === ITEM_TYPE.ITEM ? (Number(i.amount) || 0) : 0), 0
    );
    rows.push({ kind: 'sheet-total', amount: sheetTotal });
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
  overflow: 'hidden',
};

// ============================================================
// 行レンダリング
// ============================================================
const renderRow = (row, rowKey, { isLastRowOfPage, isSolidBottom }) => {
  const rowStyle = {
    ...rowBase,
    ...(isSolidBottom || isLastRowOfPage ? { borderBottom: solidBottom } : {}),
  };

  switch (row.kind) {
    case 'category': {
      const { item, catTotal } = row;
      return (
        <div key={rowKey} style={{ ...rowStyle, background: COLORS.categoryBg }}>
          <div style={{ ...CELLS.no, borderRight: 'none' }} />
          <div style={{ ...CELLS.name, flex: 7, borderRight: 'none', fontWeight: 'bold' }}>
            {item.category_symbol ? `${item.category_symbol}　` : ''}{item.name}
          </div>
          <div style={{ ...CELLS.amount, borderRight: 'none', fontWeight: 'bold' }}>
            {catTotal > 0 ? fmt(catTotal) : ''}
          </div>
          <div style={CELLS.note} />
        </div>
      );
    }
    case 'comment': {
      return (
        <div key={rowKey} style={rowStyle}>
          <div style={CELLS.no} />
          <div style={{ ...CELLS.name, flex: 5 }}>{row.item.name}</div>
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
      return (
        <div key={rowKey} style={rowStyle}>
          <div style={CELLS.no}>{itemNo}</div>
          <div style={CELLS.name}>{item.name}</div>
          <div style={CELLS.spec}>{item.spec || ''}</div>
          <div style={CELLS.qty}>{item.quantity != null ? Number(item.quantity).toLocaleString('ja-JP') : ''}</div>
          <div style={CELLS.unit}>{item.unit || ''}</div>
          <div style={CELLS.price}>{item.unit_price != null ? fmt(item.unit_price) : ''}</div>
          <div style={CELLS.amount}>{item.amount != null ? fmt(item.amount) : ''}</div>
          <div style={CELLS.note}>{item.note || ''}</div>
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
          position: 'relative',
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
  items,             // このシートに属する明細（表示順）
  header,            // estimate_number / show_fixed_fees / show_net を参照
  settings,          // フッターの会社名表示用
  totals,            // calcTotals の結果（トップシートの税抜合計・NETに使用）
  startPageNumber,   // このシート先頭ページの通し番号（鑑が No.1）
}) => {
  const isTopSheet = sheetIndex === 0;
  const rows = buildSheetRows(items, header, isTopSheet, totals);
  const estimateNumber = `${header.estimate_number_date}-${header.estimate_number_seq}-${header.estimate_number_branch}`;

  // 19行ずつページに分割
  const pages = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }

  return (
    <div id={`paper-sheet-${sheetIndex}`} style={{ display: 'flex', flexDirection: 'column', gap: pt(18), alignItems: 'center' }}>
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
          }))}

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
