import React, { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';
import { DEFAULT_COLORS } from '../../utils/constants';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

const EditColorPopup = ({ editColorPopup, currentColor, onClose, onSelectColor }) => {
    const [customColor, setCustomColor] = useState('#3B82F6');
    const [hexInput, setHexInput] = useState('#3B82F6');

    // ポップアップを開いた時点の色をカスタム欄の初期値にする
    useEffect(() => {
        if (!editColorPopup) return;
        const initial = HEX_PATTERN.test(currentColor || '') ? currentColor.toUpperCase() : '#3B82F6';
        setCustomColor(initial);
        setHexInput(initial);
    }, [editColorPopup, currentColor]);

    if (!editColorPopup) return null;

    const handlePickerChange = (e) => {
        const value = e.target.value.toUpperCase();
        setCustomColor(value);
        setHexInput(value);
    };

    const handleHexChange = (e) => {
        let value = e.target.value.trim();
        if (value && !value.startsWith('#')) value = `#${value}`;
        setHexInput(value);
        if (HEX_PATTERN.test(value)) setCustomColor(value.toUpperCase());
    };

    const isHexValid = HEX_PATTERN.test(hexInput);
    const isCurrent = (c) => (currentColor || '').toUpperCase() === c.toUpperCase();

    return (
        <div
            className="fixed z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 p-3 color-popup"
            style={{
                top: `${Math.max(8, Math.min(window.innerHeight - 260, editColorPopup.top + 10))}px`,
                left: `${Math.max(8, Math.min(window.innerWidth - 220, editColorPopup.left))}px`
            }}
        >
            <div className="flex items-center justify-between mb-2 gap-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase">配置表カラーを選択</div>
                <button
                    onClick={onClose}
                    aria-label="閉じる"
                    className="p-1 hover:bg-slate-100 rounded-full text-slate-400 transition"
                    title="閉じる"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
                {DEFAULT_COLORS.map(c => (
                    <button
                        key={c}
                        onClick={() => onSelectColor(editColorPopup.projectId, c)}
                        aria-label={`色 ${c}`}
                        title={c}
                        className={`w-8 h-8 rounded-full transition-all hover:scale-110 shadow-sm border ${isCurrent(c) ? 'border-slate-700 ring-2 ring-offset-1 ring-slate-400' : 'border-slate-100'}`}
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 mb-1.5">任意の色</div>
                <div className="flex items-center gap-2">
                    <input
                        type="color"
                        value={customColor}
                        onChange={handlePickerChange}
                        aria-label="カラーパレットから色を選択"
                        title="カラーパレットから色を選択"
                        className="w-8 h-8 p-0 border border-slate-200 rounded cursor-pointer bg-transparent"
                    />
                    <input
                        type="text"
                        value={hexInput}
                        onChange={handleHexChange}
                        maxLength={7}
                        placeholder="#RRGGBB"
                        aria-label="カラーコード"
                        className={`w-20 px-1.5 py-1 text-xs font-mono border rounded outline-none focus:ring-1 ${isHexValid ? 'border-slate-200 focus:ring-blue-400' : 'border-red-300 focus:ring-red-400'}`}
                    />
                    <button
                        onClick={() => isHexValid && onSelectColor(editColorPopup.projectId, customColor)}
                        disabled={!isHexValid}
                        aria-label="この色を適用"
                        title="この色を適用"
                        className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                        <Check size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditColorPopup;
