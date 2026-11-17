import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Percent, X } from 'lucide-react';
import { ROUND_UNITS, ROUND_MODES, isValidPercent, isUnusualPercent } from './priceAdjustOps';

// 端数の単位・方法は前回の選択を覚える（この端末・このブラウザだけ）
const STORAGE_KEY = 'estimate-price-adjust-v1';
const loadRounding = () => {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (v && ROUND_UNITS.includes(v.unit) && ROUND_MODES.some(m => m.value === v.mode)) return v;
  } catch { /* 保存できない環境では既定値 */ }
  return { unit: 1, mode: 'floor' };
};
const saveRounding = (v) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* 無視 */ }
};

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`;

/**
 * 単価の一括調整（掛率）の画面。
 * props:
 *   - targets: [{ value, label, count }]  対象の選択肢（選択中の行／各シート／全シート）
 *   - defaultTarget: string
 *   - preview: (target, { percent, unit, mode }) => { changed, skippedNegative, skippedLinked,
 *       targetBefore, targetAfter, totalBefore, totalAfter } | null
 *   - onApply: (target, { percent, unit, mode }) => void
 *   - onClose: () => void
 */
const PriceAdjustDialog = ({ targets, defaultTarget, preview, onApply, onClose }) => {
  const [target, setTarget] = useState(defaultTarget);
  const [percent, setPercent] = useState('');
  const [rounding, setRounding] = useState(loadRounding);
  const percentRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => { percentRef.current?.focus(); }, []);

  const settings = { percent, unit: rounding.unit, mode: rounding.mode };
  const valid = isValidPercent(percent);
  const unusual = valid && isUnusualPercent(percent);
  const result = useMemo(
    () => (valid ? preview(target, settings) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valid, target, percent, rounding, preview]);

  const setRound = (patch) => {
    const next = { ...rounding, ...patch };
    setRounding(next);
    saveRounding(next);
  };

  const apply = () => {
    if (!valid || !result || result.changed === 0) return;
    onApply(target, settings);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      // 全画面表示を閉じる Esc より先に、この画面だけを閉じる
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.target.tagName === 'INPUT') {
      e.preventDefault();
      // 極端な掛率は打ち間違いの恐れがあるので、Enter では実行せずボタンで確かめてもらう
      if (!unusual) apply();
    } else if (e.key === 'Tab') {
      // 画面の外（後ろの紙面・右パネル）へカーソルを出さない
      const focusable = [...dialogRef.current.querySelectorAll('input, select, button:not([disabled])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  const skipped = result ? [
    result.skippedNegative ? `マイナスの行 ${result.skippedNegative}行` : '',
    result.skippedLinked ? `リンク行 ${result.skippedLinked}行` : '',
  ].filter(Boolean).join('・') : '';

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-slate-900/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-adjust-title"
        onKeyDown={onKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 id="price-adjust-title" className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Percent size={18} className="text-blue-600" />
            単価の一括調整
          </h3>
          <button type="button" onClick={onClose} aria-label="閉じる" title="閉じる"
            className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-4 space-y-4 text-sm">
          <label className="block">
            <span className="block text-xs font-bold text-slate-500 mb-1">対象</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {targets.map(t => (
                <option key={t.value} value={t.value}>{t.label}（{t.count}行）</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-bold text-slate-500 mb-1">掛率</span>
            <div className="flex items-center gap-2">
              <input
                ref={percentRef}
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="例: 90"
                className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-500">%</span>
              <span className="text-xs text-slate-400">90% で1割引き、105% で5%値上げ</span>
            </div>
            {unusual && (
              <p role="alert" className="text-xs text-amber-700 mt-1">
                掛率が {percent}% です。打ち間違いでないか確かめてから［調整する］を押してください（Enter では実行しません）
              </p>
            )}
          </label>

          <div>
            <span className="block text-xs font-bold text-slate-500 mb-1">端数</span>
            <div className="flex items-center gap-2">
              <select
                aria-label="端数の単位"
                value={rounding.unit}
                onChange={(e) => setRound({ unit: Number(e.target.value) })}
                className="border border-slate-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {ROUND_UNITS.map(u => <option key={u} value={u}>{u}円未満を</option>)}
              </select>
              <select
                aria-label="端数の処理"
                value={rounding.mode}
                onChange={(e) => setRound({ mode: e.target.value })}
                className="border border-slate-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {ROUND_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 space-y-1" aria-live="polite">
            {result ? (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-500">変更する行</span>
                  <span className="font-medium text-slate-700">{result.changed}行</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">対象の合計</span>
                  <span className="font-medium text-slate-700">{yen(result.targetBefore)} → <span className="text-blue-700">{yen(result.targetAfter)}</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">見積合計（税抜）</span>
                  <span className="font-medium text-slate-700">{yen(result.totalBefore)} → <span className="text-blue-700">{yen(result.totalAfter)}</span></span>
                </div>
                {skipped && <p className="text-xs text-amber-700 pt-1">変更しない行: {skipped}</p>}
              </>
            ) : (
              <p className="text-slate-400 text-xs">掛率を入れると、調整後の合計をここに表示します</p>
            )}
          </div>
        </div>

        <div className="bg-slate-50 px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg font-medium text-slate-600 border border-slate-200 hover:bg-slate-200">
            キャンセル
          </button>
          <button type="button" onClick={apply}
            disabled={!valid || !result || result.changed === 0}
            className="px-4 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed">
            調整する
          </button>
        </div>
      </div>
    </div>
  );
};

export default PriceAdjustDialog;
