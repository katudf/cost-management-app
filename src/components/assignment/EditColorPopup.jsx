import React from 'react';
import { X } from 'lucide-react';
import { DEFAULT_COLORS } from '../../utils/constants';

const EditColorPopup = ({ editColorPopup, onClose, onSelectColor }) => {
    if (!editColorPopup) return null;

    return (
        <div
            className="fixed z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 p-3 color-popup"
            style={{
                top: `${Math.min(window.innerHeight - 150, editColorPopup.top + 10)}px`,
                left: `${Math.min(window.innerWidth - 200, editColorPopup.left)}px`
            }}
        >
            <div className="flex items-center justify-between mb-2 gap-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase">配置表カラーを選択</div>
                <button
                    onClick={onClose}
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
                        className="w-8 h-8 rounded-full transition-all hover:scale-110 shadow-sm border border-slate-100"
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>
        </div>
    );
};

export default EditColorPopup;
