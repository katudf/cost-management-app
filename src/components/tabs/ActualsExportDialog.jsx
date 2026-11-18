import React, { useState } from 'react';
import { X, FileSpreadsheet, FileText } from 'lucide-react';
import { useToast } from '../Toast';
import { listMonths } from '../../utils/actualsMatrixReport';

const MAX_MONTHS = 24;

/** 実績入力（マトリックス）の出力ダイアログ。開始月〜終了月を選び、Excel / PDF を出力する */
const ActualsExportDialog = ({ initialMonth, onClose, onExportExcel, onExportPdf }) => {
    const { showToast } = useToast();
    const [startMonth, setStartMonth] = useState(initialMonth);
    const [endMonth, setEndMonth] = useState(initialMonth);
    const [busy, setBusy] = useState(false);

    const run = async (exporter, label) => {
        if (!startMonth || !endMonth) {
            showToast('開始月と終了月を選んでください。', 'error');
            return;
        }
        if (listMonths(startMonth, endMonth).length > MAX_MONTHS) {
            showToast(`出力できるのは${MAX_MONTHS}か月までです。`, 'error');
            return;
        }
        setBusy(true);
        try {
            await exporter({ startMonth, endMonth });
            onClose();
        } catch (e) {
            console.error(e);
            showToast(`${label}の出力に失敗しました。`, 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="実績入力の出力">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-700">実績入力を出力</h3>
                    <button onClick={onClose} aria-label="閉じる" title="閉じる" className="text-slate-400 hover:text-slate-600">
                        <X size={18} />
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-2">
                    <label className="text-xs font-bold text-slate-500">
                        開始月
                        <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)}
                            className="mt-1 w-full border border-slate-200 rounded p-2 text-sm font-normal text-slate-700" />
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                        終了月
                        <input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)}
                            className="mt-1 w-full border border-slate-200 rounded p-2 text-sm font-normal text-slate-700" />
                    </label>
                </div>
                <p className="text-[11px] text-slate-500 mb-4">
                    同じ月にすると単月の出力です。1か月＝1シート（PDFは1ページ）で、人工（7.5時間＝1人工）の月合計と、案件の最初からの累計を表示します。
                </p>
                <div className="flex gap-2">
                    <button disabled={busy} onClick={() => run(onExportExcel, 'Excel')}
                        className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                        <FileSpreadsheet size={16} /> Excel
                    </button>
                    <button disabled={busy} onClick={() => run(onExportPdf, 'PDF')}
                        className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50">
                        <FileText size={16} /> PDF
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActualsExportDialog;
