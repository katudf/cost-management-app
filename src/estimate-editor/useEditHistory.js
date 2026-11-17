// src/estimate-editor/useEditHistory.js
// 見積エディタの「元に戻す／やり直し」フック。履歴の本体は editHistory.js の
// createHistoryController（React 非依存・単体テスト済み）で、ここでは React の state と結ぶだけ。
//
// 使い方:
//   const entry = history.edit('行の削除', { focus }, ({ header, sheets, items }) => ({ items: 次の明細 }));
//   producer は現在の状態から変更後の部分状態を同期的に返す（変化なしなら null）。
//   edit 以外で state を変えた場合（読み込み・保存・ステータス操作）は履歴に積まれない。

import { useMemo, useRef, useState } from 'react';
import { createHistoryController } from './editHistory';

/**
 * @param state       { header, sheets, items }
 * @param setters     { setHeader, setSheets, setItems }
 * @param newSheetId  仮シートIDの採番関数
 */
export const useEditHistory = ({ header, sheets, items }, { setHeader, setSheets, setItems }, newSheetId) => {
  const [view, setView] = useState({ undoLabel: null, redoLabel: null });
  const settersRef = useRef({ setHeader, setSheets, setItems });
  settersRef.current = { setHeader, setSheets, setItems };

  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createHistoryController({
      newSheetId,
      apply: (next, prev) => {
        const s = settersRef.current;
        if (!prev || next.header !== prev.header) s.setHeader(next.header);
        if (!prev || next.sheets !== prev.sheets) s.setSheets(next.sheets);
        if (!prev || next.items !== prev.items) s.setItems(next.items);
      },
      onView: (v) => setView(cur =>
        cur.undoLabel === v.undoLabel && cur.redoLabel === v.redoLabel ? cur : v),
    });
  }
  const ctrl = controllerRef.current;
  // 描画された最新状態を取り込む（保存・読み込み等の edit 以外の変化もここで反映される）
  ctrl.sync({ header, sheets, items });

  return useMemo(() => ({
    edit: ctrl.edit,
    undo: ctrl.undo,
    redo: ctrl.redo,
    undoIfTop: ctrl.undoIfTop,
    clear: ctrl.clear,
    breakCoalesce: ctrl.breakCoalesce,
    setKnownSheetIds: ctrl.setKnownSheetIds,
    remapSheetIds: ctrl.remapSheetIds,
    undoLabel: view.undoLabel,
    redoLabel: view.redoLabel,
  }), [ctrl, view]);
};
