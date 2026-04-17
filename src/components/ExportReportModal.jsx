import React from 'react';
import { FileText, FileSpreadsheet, Printer } from 'lucide-react';

const ExportReportModal = ({ isOpen, workerName, workerNames, exportWeekStart, setExportWeekStart, onClose, onExport, onExportPDF, isLoading }) => {
    if (!isOpen) return null;

    const names = workerNames || (workerName ? [workerName] : []);
    if (names.length === 0) return null;

    const isBatch = names.length > 1;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <FileText className="text-blue-500" />
                    就労日報の出力
                </h3>

                {isBatch ? (
                    <div className="mb-6">
                        <p className="text-slate-600 font-bold text-sm mb-2">
                            対象作業員: <span className="text-blue-600 text-base">{names.length}名</span>
                        </p>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-[120px] overflow-y-auto">
                            <div className="flex flex-wrap gap-1.5">
                                {names.map((name, i) => (
                                    <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full border border-blue-200 font-bold">
                                        {name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-slate-600 mb-6 font-bold text-sm">
                        対象作業員: <span className="text-blue-600 text-base">{names[0]}</span> さん
                    </p>
                )}

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
                        onClick={onExportPDF}
                        disabled={isLoading}
                        className="px-4 py-2 rounded-lg font-bold text-white bg-rose-600 hover:bg-rose-700 transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <Printer size={16} />
                        {isLoading ? '出力中...' : isBatch ? `PDF一括出力` : 'PDF出力'}
                    </button>
                    <button
                        onClick={onExport}
                        disabled={isLoading}
                        className="px-4 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <FileSpreadsheet size={16} />
                        {isLoading ? '出力中...' : isBatch ? `Excel一括出力` : 'Excel出力'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExportReportModal;
