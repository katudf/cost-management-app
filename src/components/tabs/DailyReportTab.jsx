import React, { useState, useMemo } from 'react';
import { FileText, User, Edit3 } from 'lucide-react';
import { calculateAge } from '../../utils/dateUtils';

const DailyReportTab = ({
    isLoading,
    workers,
    workerSummaryData,
    setExportModalWorker,
}) => {
    const [showResigned, setShowResigned] = useState(false);
    const [checkedWorkers, setCheckedWorkers] = useState({});

    // 作業員マスターの順序に同期しつつ、退社済みフィルターを適用
    const filteredSummaryData = useMemo(() => {
        const base = showResigned
            ? (workerSummaryData || [])
            : (workerSummaryData || []).filter(data => {
                const worker = workers.find(w => w.name === data.name);
                return !worker || !worker.resignation_date;
            });

        return [...base].sort((a, b) => {
            const idxA = workers.findIndex(w => w.name === a.name);
            const idxB = workers.findIndex(w => w.name === b.name);
            const orderA = idxA === -1 ? Infinity : idxA;
            const orderB = idxB === -1 ? Infinity : idxB;
            return orderA - orderB;
        });
    }, [workerSummaryData, workers, showResigned]);

    const allChecked = filteredSummaryData.length > 0 && filteredSummaryData.every(d => checkedWorkers[d.name]);
    const checkedCount = filteredSummaryData.filter(d => checkedWorkers[d.name]).length;

    const handleToggleAll = () => {
        if (allChecked) {
            setCheckedWorkers({});
        } else {
            const next = {};
            filteredSummaryData.forEach(d => { next[d.name] = true; });
            setCheckedWorkers(next);
        }
    };

    const handleToggleWorker = (name) => {
        setCheckedWorkers(prev => ({ ...prev, [name]: !prev[name] }));
    };

    const handleBatchExport = () => {
        const selected = filteredSummaryData.filter(d => checkedWorkers[d.name]).map(d => d.name);
        if (selected.length === 0) return;
        setExportModalWorker(selected.length === 1 ? selected[0] : selected);
    };

    return (
        <div className={`p-6 bg-slate-50 min-h-[500px] ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <FileText className="text-blue-600" /> 作業員別 日報出力
                </h2>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleBatchExport}
                        disabled={checkedCount === 0}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <FileText size={16} />
                        {checkedCount > 0 ? `${checkedCount}名分を出力` : '出力する作業員を選択'}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-slate-100 text-slate-600 text-xs tracking-wider uppercase">
                            <th className="p-3 font-bold rounded-l-lg w-10 text-center">
                                <input
                                    type="checkbox"
                                    checked={allChecked}
                                    onChange={handleToggleAll}
                                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                                    title="全選択/全解除"
                                />
                            </th>
                            <th className="p-3 font-bold">作業員名</th>
                            <th className="p-3 font-bold rounded-r-lg w-32"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredSummaryData.length === 0 ? (
                            <tr>
                                <td colSpan="3" className="p-8 text-center text-slate-400 font-bold">まだ作業実績がありません</td>
                            </tr>
                        ) : (
                            filteredSummaryData.map((data, idx) => {
                                const worker = workers.find(w => w.name === data.name);
                                return (
                                    <tr
                                        key={idx}
                                        className={`transition cursor-pointer ${checkedWorkers[data.name] ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-slate-50'}`}
                                        onClick={() => handleToggleWorker(data.name)}
                                    >
                                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={!!checkedWorkers[data.name]}
                                                onChange={() => handleToggleWorker(data.name)}
                                                className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                                            />
                                        </td>
                                        <td className="p-3 font-bold text-slate-800">
                                            <div className="flex items-center gap-2 whitespace-nowrap">
                                                <User size={16} className="text-slate-400" /> {data.name}
                                                {worker?.birthDate && (
                                                    <span className="text-xs font-normal text-slate-500">
                                                        ({calculateAge(worker.birthDate)}歳)
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                                            {worker?.id && (
                                                <a
                                                    href={`/worker.html?mode=worker&workerId=${worker.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 transition"
                                                    title={`${data.name}さんの日報編集画面を開く`}
                                                >
                                                    <Edit3 size={14} /> 日報編集
                                                </a>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default React.memo(DailyReportTab);
