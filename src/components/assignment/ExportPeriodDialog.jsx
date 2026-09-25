// src/components/assignment/ExportPeriodDialog.jsx
// 配置表Excel出力時の期間指定ダイアログ。開くたびに既定値（現在の表示範囲）へリセットする。

import React, { useState, useEffect } from 'react';
import { X, Download } from 'lucide-react';

const ExportPeriodDialog = ({ isOpen, defaultStart, defaultEnd, onClose, onExport, isExporting }) => {
    const [start, setStart] = useState(defaultStart);
    const [end, setEnd] = useState(defaultEnd);

    useEffect(() => {
        if (isOpen) {
            setStart(defaultStart);
            setEnd(defaultEnd);
        }
    }, [isOpen, defaultStart, defaultEnd]);

    if (!isOpen) return null;

    const isValid = !!start && !!end && start <= end;

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-800 text-lg">Excel出力の期間指定</h3>
                    <button
                        onClick={onClose}
                        aria-label="閉じる"
                        title="閉じる"
                        className="p-1 rounded hover:bg-slate-100 text-slate-500"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-3 mb-2">
                    <label className="block text-sm text-slate-600">
                        開始日
                        <input
                            type="date"
                            value={start}
                            onChange={e => setStart(e.target.value)}
                            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                    </label>
                    <label className="block text-sm text-slate-600">
                        終了日
                        <input
                            type="date"
                            value={end}
                            min={start}
                            onChange={e => setEnd(e.target.value)}
                            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                    </label>
                </div>
                {start && end && start > end && (
                    <p className="text-xs text-red-500 mb-2">終了日は開始日以降を指定してください</p>
                )}

                <div className="flex gap-3 justify-end mt-5">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold transition"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={() => onExport(start, end)}
                        disabled={!isValid || isExporting}
                        className="px-4 py-2 rounded-lg text-white font-bold transition flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                        <Download size={16} /> {isExporting ? '出力中...' : '出力'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExportPeriodDialog;
