import React from 'react';
import { FileText } from 'lucide-react';

const ExportReportModal = ({ isOpen, workerName, exportWeekStart, setExportWeekStart, onClose, onExport, isLoading }) => {
    if (!isOpen || !workerName) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <FileText className="text-blue-500" />
                    就労日報の出力
                </h3>
                <p className="text-slate-600 mb-6 font-bold text-sm">
                    対象作業員: <span className="text-blue-600 text-base">{workerName}</span> さん
                </p>

                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-500 mb-2">出力する週（月曜始まり）</label>
                    <input
                        type="date"
                        value={exportWeekStart}
                        onChange={(e) => {
                            const d = new Date(e.target.value);
                            const day = d.getDay();
                            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                            const newDate = new Date(d.setDate(diff)).toISOString().split('T')[0];
                            setExportWeekStart(newDate);
                        }}
                        className="w-full border-2 border-slate-200 p-3 rounded-lg font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                    />
                </div>

                <div className="flex gap-3 justify-end mt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition"
                    >キャンセル</button>
                    <button
                        onClick={onExport}
                        disabled={isLoading}
                        className="px-4 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50"
                    >
                        {isLoading ? '出力中...' : 'Excel出力'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExportReportModal;
