import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Plus, Trash2, GripVertical, MessageSquare, Copy, FileDown } from 'lucide-react';
import { ITEM_TYPE } from '../../utils/constants';
import { formatCurrency } from '../../supabaseEstimates';

const UNIT_SUGGESTIONS = ['m²', 'm', 'm³', '本', '式', 'ヶ所', '個', 't', '枚', '組'];

// Tab順列定義（金額列はスキップ）
const ITEM_COL_KEYS = ['name', 'spec', 'quantity', 'unit', 'unit_price', 'note'];

const isNavigable = (type) =>
  type === ITEM_TYPE.ITEM || type === ITEM_TYPE.CATEGORY || type === ITEM_TYPE.COMMENT;

const getColCount = (itemType) => {
  if (itemType === ITEM_TYPE.CATEGORY) return 2;
  if (itemType === ITEM_TYPE.COMMENT)  return 1;
  return ITEM_COL_KEYS.length;
};

const getNextTarget = (items, rowIdx, colIdx) => {
  const item = items[rowIdx];
  if (!item || !isNavigable(item.item_type)) return null;
  const colCount = getColCount(item.item_type);
  if (colIdx < colCount - 1) return { type: 'focus', rowIdx, colIdx: colIdx + 1 };
  for (let i = rowIdx + 1; i < items.length; i++) {
    if (isNavigable(items[i].item_type)) return { type: 'focus', rowIdx: i, colIdx: 0 };
  }
  if (item.item_type === ITEM_TYPE.ITEM) return { type: 'addRow', afterRowIdx: rowIdx };
  return null;
};

// ============================================================
// Drag helpers
// ============================================================

/** CATEGORY行のグループ（CATEGORY + 配下の全ITEM/COMMENT）のインデックスを返す */
const getCategoryGroupIndices = (items, catIdx) => {
  const result = [catIdx];
  for (let i = catIdx + 1; i < items.length; i++) {
    const t = items[i].item_type;
    if (t === ITEM_TYPE.FIXED || t === ITEM_TYPE.CATEGORY) break;
    result.push(i);
  }
  return result;
};

/** srcIndices の行群を dropBeforeIdx の直前に移動した新配列を返す */
const doReorder = (items, srcIndices, dropBeforeIdx) => {
  const srcSet = new Set(srcIndices);
  // ドロップ先が移動元グループ内なら何もしない
  if (srcSet.has(dropBeforeIdx)) return items;

  const srcItems = srcIndices.map(i => items[i]);
  const remaining = items
    .map((item, i) => ({ item, origIdx: i }))
    .filter(({ origIdx }) => !srcSet.has(origIdx));

  // dropBeforeIdx (元配列の位置) が remaining 内で何番目になるか探す
  let insertPos = remaining.length; // デフォルト: 末尾
  for (let j = 0; j < remaining.length; j++) {
    if (remaining[j].origIdx === dropBeforeIdx) {
      insertPos = j;
      break;
    }
  }

  const result = [
    ...remaining.slice(0, insertPos).map(x => x.item),
    ...srcItems,
    ...remaining.slice(insertPos).map(x => x.item),
  ];
  return result.map((r, i) => ({ ...r, sort_order: i }));
};

/** 選択行（CATEGORY は配下ごと）を複製して挿入した新配列を返す */
const doCopy = (items, selectedIndices) => {
  // CATEGORY行は配下も展開
  const expandedSet = new Set(selectedIndices);
  selectedIndices.forEach(idx => {
    if (items[idx]?.item_type === ITEM_TYPE.CATEGORY) {
      getCategoryGroupIndices(items, idx).forEach(i => expandedSet.add(i));
    }
  });

  const sortedIndices = [...expandedSet].sort((a, b) => a - b);
  const copies = sortedIndices.map(i => ({
    ...items[i],
    id: undefined,
    _tempId: `copy_${Date.now()}_${Math.random()}_${i}`,
  }));

  // FIXED行より前に挿入する
  const insertAfter = Math.max(...sortedIndices);
  const fixedStart = items.findIndex(item => item.item_type === ITEM_TYPE.FIXED);
  const clampedInsert = fixedStart !== -1 ? Math.min(insertAfter, fixedStart - 1) : insertAfter;

  const result = [
    ...items.slice(0, clampedInsert + 1),
    ...copies,
    ...items.slice(clampedInsert + 1),
  ];
  return result.map((r, i) => ({ ...r, sort_order: i }));
};

// ============================================================
// 明細行コンポーネント
// 列構成（10列）:
//  0: checkbox  1: grip  2: 名称  3: 仕様  4: 数量  5: 単位  6: 単価  7: 金額  8: 摘要  9: 削除
// ============================================================
const ItemRow = ({
  item, index, onChange, onAddItem, onRemove, disabled,
  selected, onToggleSelect,
  isDragSource, dropIndicator,
  categorySubtotal,
}) => {
  const [showUnitSug, setShowUnitSug] = useState(false);

  const trStyle = {};
  if (dropIndicator === 'above') trStyle.borderTop    = '3px solid #3b82f6';
  if (dropIndicator === 'below') trStyle.borderBottom = '3px solid #3b82f6';

  const opacityCls = isDragSource ? 'opacity-40' : '';

  const checkboxTd = (
    <td className="px-1 py-1.5 w-5">
      {!disabled && item.item_type !== ITEM_TYPE.FIXED && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={e => e.stopPropagation()}
          className="w-3 h-3 rounded cursor-pointer accent-blue-500"
        />
      )}
    </td>
  );

  // ── CATEGORY ──
  if (item.item_type === ITEM_TYPE.CATEGORY) {
    return (
      <tr
        data-row-idx={index}
        draggable
        style={trStyle}
        className={`bg-blue-50 border-t border-blue-100 ${opacityCls}`}
      >
        {checkboxTd}
        <td className="px-2 py-1.5 cursor-grab text-slate-400 select-none">
          <GripVertical size={14} />
        </td>
        <td colSpan={5} className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={item.category_symbol || ''}
              onChange={e => onChange('category_symbol', e.target.value)}
              data-row-idx={index}
              data-col-idx={0}
              className="w-8 border border-slate-300 rounded px-1 py-1 text-xs font-bold bg-white text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="A"
              disabled={disabled}
            />
            <input
              type="text"
              value={item.name || ''}
              onChange={e => onChange('name', e.target.value)}
              data-row-idx={index}
              data-col-idx={1}
              className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs font-bold bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="工種名（例: 校舎・体育館）"
              disabled={disabled}
            />
            {!disabled && (
              <button
                onClick={onAddItem}
                title="この工種に細別追加"
                aria-label="この工種に細別追加"
                className="text-blue-500 hover:text-blue-700 ml-1"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </td>
        {/* 工種小計（金額列） */}
        <td className="px-2 py-1.5 text-right font-bold text-blue-700 text-xs">
          {categorySubtotal > 0 ? formatCurrency(categorySubtotal) : ''}
        </td>
        <td className="px-2 py-1.5"></td>{/* 摘要列（空） */}
        <td className="px-2 py-1.5">
          {!disabled && (
            <button onClick={onRemove} aria-label="行を削除" title="行を削除" className="text-red-400 hover:text-red-600">
              <Trash2 size={14} />
            </button>
          )}
        </td>
      </tr>
    );
  }

  // ── COMMENT ──
  if (item.item_type === ITEM_TYPE.COMMENT) {
    return (
      <tr
        data-row-idx={index}
        draggable
        style={trStyle}
        className={`bg-slate-100 border-t border-slate-200 ${opacityCls}`}
      >
        {checkboxTd}
        <td className="px-2 py-1.5 cursor-grab select-none">
          <MessageSquare size={13} className="text-slate-400" />
        </td>
        <td colSpan={7} className="px-2 py-1.5">
          <input
            type="text"
            value={item.name || ''}
            onChange={e => onChange('name', e.target.value)}
            data-row-idx={index}
            data-col-idx={0}
            className="w-full border border-slate-200 rounded px-2 py-1 text-xs italic text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white placeholder:not-italic"
            placeholder="コメントを入力..."
            disabled={disabled}
          />
        </td>
        <td className="px-2 py-1.5">
          {!disabled && (
            <button onClick={onRemove} aria-label="行を削除" title="行を削除" className="text-red-400 hover:text-red-600">
              <Trash2 size={14} />
            </button>
          )}
        </td>
      </tr>
    );
  }

  // ── FIXED ──
  if (item.item_type === ITEM_TYPE.FIXED) {
    return (
      <tr style={trStyle} className="bg-amber-50 border-t border-amber-100">
        <td className="px-1 py-1.5 w-5"></td>
        <td className="px-2 py-1.5"></td>
        <td className="px-2 py-1.5 font-bold text-slate-600">{item.name}</td>
        <td className="px-2 py-1.5"></td>
        <td className="px-2 py-1.5 text-right text-slate-500 text-xs">1.0</td>
        <td className="px-2 py-1.5 text-slate-500 text-xs">式</td>
        <td className="px-2 py-1.5"></td>
        <td className="px-2 py-1.5">
          <input
            type="number"
            min="0"
            value={item.amount || ''}
            onChange={e => onChange('amount', e.target.value)}
            className="w-full border border-slate-300 rounded px-1 py-1 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="0"
            disabled={disabled}
          />
        </td>
        <td colSpan={2} className="px-2 py-1.5"></td>
      </tr>
    );
  }

  // ── ITEM ──
  return (
    <tr
      data-row-idx={index}
      draggable
      style={trStyle}
      className={`border-t border-slate-100 hover:bg-slate-50 ${opacityCls}`}
    >
      {checkboxTd}
      <td className="px-2 py-1.5 cursor-grab text-slate-300 select-none">
        <GripVertical size={14} />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={item.name || ''}
          onChange={e => onChange('name', e.target.value)}
          data-row-idx={index}
          data-col-idx={0}
          className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="名称"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={item.spec || ''}
          onChange={e => onChange('spec', e.target.value)}
          data-row-idx={index}
          data-col-idx={1}
          className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="仕様"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min="0"
          value={item.quantity || ''}
          onChange={e => onChange('quantity', e.target.value)}
          data-row-idx={index}
          data-col-idx={2}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="0"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5 relative">
        <input
          type="text"
          value={item.unit || ''}
          onChange={e => onChange('unit', e.target.value)}
          onFocus={() => !disabled && setShowUnitSug(true)}
          onBlur={() => setTimeout(() => setShowUnitSug(false), 150)}
          data-row-idx={index}
          data-col-idx={3}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="単位"
          disabled={disabled}
        />
        {showUnitSug && !disabled && (
          <div className="absolute top-full left-0 z-10 bg-white border border-slate-200 rounded shadow-lg py-1 min-w-max">
            {UNIT_SUGGESTIONS.map(u => (
              <button
                key={u}
                onMouseDown={() => onChange('unit', u)}
                className="block w-full text-left px-3 py-1 text-xs hover:bg-blue-50"
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min="0"
          value={item.unit_price || ''}
          onChange={e => onChange('unit_price', e.target.value)}
          data-row-idx={index}
          data-col-idx={4}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="0"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        {/* 金額列: data-col-idx なし → Tab スキップ */}
        <input
          type="number"
          min="0"
          value={item.amount || ''}
          onChange={e => onChange('amount', e.target.value)}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50"
          placeholder="自動計算"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={item.note || ''}
          onChange={e => onChange('note', e.target.value)}
          data-row-idx={index}
          data-col-idx={5}
          className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="摘要"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        {!disabled && (
          <button onClick={onRemove} aria-label="行を削除" title="行を削除" className="text-red-400 hover:text-red-600">
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
};

// ============================================================
// 明細テーブルコンポーネント
// ============================================================
const EstimateItemTable = ({
  items,
  showFixedFees,
  showSubtotals,
  categorySubtotals,
  onUpdateItem,
  onAddCategory,
  onAddItem,
  onAddComment,
  onRemoveRow,
  onSetItems,
  onImportItems,
  disabled,
}) => {
  const tableRef = useRef(null);
  const pendingFocusRef = useRef(null);

  // 選択状態
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  // ドラッグ状態
  const [dragSrcIndices, setDragSrcIndices] = useState(null);
  const [dropLine, setDropLine] = useState(null); // 挿入先インデックス (0〜items.length)

  // 工種ごとの小計（CATEGORY行ヘッダーに表示するため内部計算）
  const catSubtotalMap = useMemo(() => {
    const map = new Map();
    let currentCat = null;
    items.forEach(item => {
      if (item.item_type === ITEM_TYPE.CATEGORY) {
        currentCat = item;
        map.set(item, 0);
      } else if (item.item_type === ITEM_TYPE.ITEM && currentCat) {
        map.set(currentCat, (map.get(currentCat) || 0) + (Number(item.amount) || 0));
      }
    });
    return map;
  }, [items]);

  // 新行追加後フォーカス
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    const { rowIdx, colIdx } = pendingFocusRef.current;
    pendingFocusRef.current = null;
    tableRef.current
      ?.querySelector(`[data-row-idx="${rowIdx}"][data-col-idx="${colIdx}"]`)
      ?.focus();
  }, [items.length]);

  // ── キーボードナビゲーション ──
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab' || e.shiftKey || disabled) return;
    const rowIdxStr = e.target.dataset?.rowIdx;
    const colIdxStr = e.target.dataset?.colIdx;
    if (rowIdxStr === undefined || colIdxStr === undefined) return;
    const rowIdx = parseInt(rowIdxStr, 10);
    const colIdx = parseInt(colIdxStr, 10);
    if (isNaN(rowIdx) || isNaN(colIdx)) return;
    const result = getNextTarget(items, rowIdx, colIdx);
    if (!result) return;
    e.preventDefault();
    if (result.type === 'focus') {
      tableRef.current
        ?.querySelector(`[data-row-idx="${result.rowIdx}"][data-col-idx="${result.colIdx}"]`)
        ?.focus();
    } else if (result.type === 'addRow') {
      pendingFocusRef.current = { rowIdx: result.afterRowIdx + 1, colIdx: 0 };
      onAddItem(result.afterRowIdx);
    }
  }, [items, disabled, onAddItem]);

  // ── ドラッグ＆ドロップ（イベント委譲） ──

  const getFixedStart = useCallback(() =>
    items.findIndex(i => i.item_type === ITEM_TYPE.FIXED), [items]);

  const handleTableDragStart = useCallback((e) => {
    if (disabled) { e.preventDefault(); return; }
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) { e.preventDefault(); return; }
    const rowIndex = parseInt(tr.dataset.rowIdx, 10);
    const item = items[rowIndex];
    if (!item || item.item_type === ITEM_TYPE.FIXED) { e.preventDefault(); return; }

    const srcIndices = item.item_type === ITEM_TYPE.CATEGORY
      ? getCategoryGroupIndices(items, rowIndex)
      : [rowIndex];

    setDragSrcIndices(srcIndices);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires setData
    e.dataTransfer.setData('text/plain', rowIndex.toString());
  }, [disabled, items]);

  const handleTableDragOver = useCallback((e) => {
    if (!dragSrcIndices) return;
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) return;
    const rowIndex = parseInt(tr.dataset.rowIdx, 10);
    const item = items[rowIndex];
    if (!item || item.item_type === ITEM_TYPE.FIXED) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = tr.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const raw = e.clientY < mid ? rowIndex : rowIndex + 1;

    // FIXED行より後ろにはドロップさせない
    const fixedStart = getFixedStart();
    const clamped = fixedStart !== -1 ? Math.min(raw, fixedStart) : raw;

    setDropLine(clamped);
  }, [dragSrcIndices, items, getFixedStart]);

  const handleTableDragLeave = useCallback((e) => {
    // テーブル全体から出たときだけクリア
    if (!tableRef.current?.contains(e.relatedTarget)) {
      setDropLine(null);
    }
  }, []);

  const handleTableDrop = useCallback((e) => {
    e.preventDefault();
    if (!dragSrcIndices || dropLine === null) return;
    onSetItems(doReorder(items, dragSrcIndices, dropLine));
    setDragSrcIndices(null);
    setDropLine(null);
  }, [dragSrcIndices, dropLine, items, onSetItems]);

  const handleTableDragEnd = useCallback(() => {
    setDragSrcIndices(null);
    setDropLine(null);
  }, []);

  // ── 選択操作 ──
  const toggleSelect = useCallback((index) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }, []);

  const handleCopy = () => {
    if (selectedIndices.size === 0) return;
    onSetItems(doCopy(items, [...selectedIndices]));
    setSelectedIndices(new Set());
  };

  const handleDeleteSelected = () => {
    // CATEGORY行は配下も削除
    const toDelete = new Set(selectedIndices);
    [...selectedIndices].forEach(idx => {
      if (items[idx]?.item_type === ITEM_TYPE.CATEGORY) {
        getCategoryGroupIndices(items, idx).forEach(i => toDelete.add(i));
      }
    });
    onSetItems(
      items
        .filter((_, i) => !toDelete.has(i))
        .map((r, i) => ({ ...r, sort_order: i }))
    );
    setSelectedIndices(new Set());
  };

  // ── 工種小計ヘルパー ──
  const isLastItemBeforeNext = (index) => {
    if (!showSubtotals) return false;
    const item = items[index];
    if (item.item_type !== ITEM_TYPE.ITEM) return false;
    for (let j = index + 1; j < items.length; j++) {
      if (items[j].item_type === ITEM_TYPE.CATEGORY || items[j].item_type === ITEM_TYPE.FIXED) return true;
      if (items[j].item_type === ITEM_TYPE.ITEM) return false;
    }
    return true;
  };

  const getCategoryKeyForIndex = (index) => {
    for (let i = index; i >= 0; i--) {
      if (items[i].item_type === ITEM_TYPE.CATEGORY) {
        return items[i].id || items[i]._tempId || items[i].category_symbol;
      }
    }
    return null;
  };

  const hasSelection = selectedIndices.size > 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
        <h3 className="font-bold text-slate-700 text-sm">
          見積内訳明細（{items.length}行）
        </h3>
        {hasSelection && !disabled && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{selectedIndices.size}行選択</span>
            <button
              onClick={handleCopy}
              title="選択行をコピーして下に挿入"
              aria-label="選択行をコピー"
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2 py-1 rounded-lg transition"
            >
              <Copy size={12} />コピー
            </button>
            <button
              onClick={handleDeleteSelected}
              title="選択行を削除"
              aria-label="選択行を削除"
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2 py-1 rounded-lg transition"
            >
              <Trash2 size={12} />削除
            </button>
          </div>
        )}
      </div>

      {/* テーブル本体 */}
      <div
        ref={tableRef}
        onKeyDown={handleKeyDown}
        onDragStart={handleTableDragStart}
        onDragOver={handleTableDragOver}
        onDragLeave={handleTableDragLeave}
        onDrop={handleTableDrop}
        onDragEnd={handleTableDragEnd}
        className="overflow-x-auto"
      >
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-500">
              {/* checkbox */}
              <th className="px-1 py-2 w-5"></th>
              {/* grip */}
              <th className="px-2 py-2 w-6"></th>
              <th className="px-2 py-2 text-left min-w-32">名称</th>
              <th className="px-2 py-2 text-left min-w-40">仕様</th>
              <th className="px-2 py-2 text-right w-16">数量</th>
              <th className="px-2 py-2 text-left w-14">単位</th>
              <th className="px-2 py-2 text-right w-20">単価</th>
              <th className="px-2 py-2 text-right w-24">金額</th>
              <th className="px-2 py-2 text-left min-w-20">摘要</th>
              {/* delete */}
              <th className="px-2 py-2 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              if (item.item_type === ITEM_TYPE.FIXED && !showFixedFees) return null;
              if (item.item_type === ITEM_TYPE.SUBTOTAL) return null;

              const isDragSource = !!(dragSrcIndices?.includes(index));

              // ドロップラインのビジュアル:
              //  dropLine === index → このrow の上に青線
              //  dropLine > index かつ次の表示行が無い → このrow の下に青線
              let dropIndicator = null;
              if (dropLine !== null) {
                if (dropLine === index) {
                  dropIndicator = 'above';
                } else if (dropLine > index) {
                  // dropLine より前に visible な行がこれ以上ないか確認
                  const hasNextVisible = items.slice(index + 1).some(
                    (it, offset) => {
                      const absIdx = index + 1 + offset;
                      if (absIdx >= dropLine) return false;
                      if (it.item_type === ITEM_TYPE.SUBTOTAL) return false;
                      if (!showFixedFees && it.item_type === ITEM_TYPE.FIXED) return false;
                      return true;
                    }
                  );
                  if (!hasNextVisible) dropIndicator = 'below';
                }
              }

              return (
                <React.Fragment key={item.id || item._tempId || index}>
                  <ItemRow
                    item={item}
                    index={index}
                    onChange={(field, value) => onUpdateItem(index, field, value)}
                    onAddItem={() => onAddItem(index)}
                    onRemove={() => onRemoveRow(index)}
                    disabled={disabled}
                    selected={selectedIndices.has(index)}
                    onToggleSelect={() => toggleSelect(index)}
                    isDragSource={isDragSource}
                    dropIndicator={dropIndicator}
                    categorySubtotal={catSubtotalMap.get(item) || 0}
                  />
                  {isLastItemBeforeNext(index) && (() => {
                    const catKey = getCategoryKeyForIndex(index);
                    const subtotal = catKey ? (categorySubtotals[catKey] || 0) : 0;
                    return (
                      <tr className="bg-slate-50 border-b border-slate-300">
                        <td className="px-1 py-1.5"></td>
                        <td className="px-2 py-1.5"></td>
                        <td colSpan={5} className="px-2 py-1.5 text-right font-bold text-slate-600 text-xs pr-4">
                          合　計
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-slate-700 text-xs">
                          {formatCurrency(subtotal)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    );
                  })()}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* アクションバー */}
      {!disabled && (
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            onClick={onAddCategory}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-bold border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition"
          >
            <Plus size={15} />
            工種を追加
          </button>
          <button
            onClick={onAddComment}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 font-bold border border-slate-200 hover:border-slate-400 px-3 py-1.5 rounded-lg transition"
          >
            <MessageSquare size={14} />
            コメント行を追加
          </button>
          <button
            onClick={onImportItems}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 font-bold border border-slate-200 hover:border-slate-400 px-3 py-1.5 rounded-lg transition"
          >
            <FileDown size={14} />
            過去見積から取込
          </button>
        </div>
      )}
    </div>
  );
};

export default EstimateItemTable;
