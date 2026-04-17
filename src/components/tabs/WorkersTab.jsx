import React, { useState, useMemo } from 'react';
import { Users, Settings, Plus, Calendar, BarChart3, User, ChevronRight, FileText } from 'lucide-react';
import { calculateAge } from '../../utils/dateUtils';
import WorkerDetailsModal from '../WorkerDetailsModal';

const WorkersTab = ({
    isLoading,
    workers,
    addWorker,
    handleWorkerReorder,
    openEditWorkerModal,
    removeWorker,
    workerSummaryData,
    setExportModalWorker
}) => {
    const [selectedWorkerForDetails, setSelectedWorkerForDetails] = useState(null);
    const [showResigned, setShowResigned] = useState(false);
    const [checkedWorkers, setCheckedWorkers] = useState({});

    const filteredWorkers = useMemo(() => {
        if (showResigned) return workers;
        return (workers || []).filter(w => !w.resignation_date);
    }, [workers, showResigned]);

    const filteredSummaryData = useMemo(() => {
        if (showResigned) return workerSummaryData;
        return (workerSummaryData || []).filter(data => {
            const worker = workers.find(w => w.name === data.name);
            return !worker || !worker.resignation_date;
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
            <WorkerDetailsModal 
                isOpen={!!selectedWorkerForDetails}
                worker={workers.find(w => w.id === selectedWorkerForDetails)}
                onClose={() => setSelectedWorkerForDetails(null)}
                onEdit={openEditWorkerModal}
                onDelete={removeWorker}
            />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users className="text-blue-600" /> 作業員管理・稼働確認</h2>
                <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={showResigned}
                            onChange={(e) => setShowResigned(e.target.checked)}
                            className="w-4 h-4 rounded accent-blue-600"
                        />
                        <span className="text-sm font-bold text-slate-600">退社済みの作業員を表示</span>
                    </label>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 左側：マスター管理（名簿・順番） */}
                <div className="bg-white rounded-xl border object-contain border-slate-200 shadow-sm p-4 h-fit">
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2">
                            <Settings size={18} className="text-slate-400" />
                            作業員マスター設定
                        </h3>
                        <button
                            onClick={addWorker}
                            className="text-white bg-blue-600 px-3 py-1.5 rounded text-sm font-bold flex items-center gap-1 hover:bg-blue-700 transition"
                        >
                            <Plus size={16} /> 追加する
                        </button>
                    </div>
                    <div className="space-y-2">
                        {filteredWorkers.map((worker, idx) => (
                            <div 
                                key={worker.id}
                                className="flex flex-col sm:flex-row items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-white transition group gap-2 cursor-grab active:cursor-grabbing"
                                draggable={true}
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('workerid', worker.id.toString());
                                    e.dataTransfer.effectAllowed = 'copyMove';
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    e.currentTarget.classList.add('bg-slate-200');
                                }}
                                onDragLeave={(e) => {
                                    e.currentTarget.classList.remove('bg-slate-200');
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.currentTarget.classList.remove('bg-slate-200');
                                    const draggedWorkerId = e.dataTransfer.getData('workerid');
                                    if (draggedWorkerId) {
                                        handleWorkerReorder(parseInt(draggedWorkerId, 10), worker.id);
                                    }
                                }}
                                onClick={() => setSelectedWorkerForDetails(worker.id)}
                            >
                                <div className="flex items-center gap-3 w-full sm:w-auto">
                                    <span className="text-xs text-slate-400 font-mono w-4">{idx + 1}</span>
                                    <div className="flex flex-col min-w-[150px]">
                                        <span className="text-[10px] text-slate-400 font-bold">{worker.kana || 'フリガナ未設定'}</span>
                                        <span className="font-bold text-lg text-slate-800 group-hover:text-blue-700 transition">{worker.name}</span>
                                    </div>
                                    <div className="flex flex-col text-sm text-slate-600 ml-4 hidden md:flex">
                                        <div className="flex items-center gap-1"><Calendar size={14} className="text-slate-400" /> {worker.birthDate ? `${calculateAge(worker.birthDate)}歳` : '年齢未定'}</div>
                                    </div>
                                    <div className="flex flex-col text-sm text-slate-600 ml-4 hidden lg:flex">
                                        <span className="text-xs text-slate-500">{worker.contactInfo || '連絡先未設定'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center text-slate-400 opacity-60 mr-2 mt-2 sm:mt-0 group-hover:opacity-100 group-hover:text-blue-500 transition">
                                    <span className="text-xs font-bold mr-1 hidden sm:inline">詳細</span>
                                    <ChevronRight size={18} />
                                </div>
                            </div>
                        ))}
                        {filteredWorkers.length === 0 && (
                            <div className="text-center py-8 text-slate-400 font-bold text-sm">作業員が登録されていません</div>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-4 leading-relaxed">
                        ※ここでの表示順（上から順）が、作業員アプリ（スマホ側）のログイン画面や実績入力時のリストの順番になります。
                    </p>
                </div>

                {/* 右側：日報出力 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 h-fit">
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2">
                            <BarChart3 size={18} className="text-slate-400" />
                            作業員別 日報出力
                        </h3>
                        <button
                            onClick={handleBatchExport}
                            disabled={checkedCount === 0}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <FileText size={16} />
                            {checkedCount > 0 ? `${checkedCount}名分を出力` : '出力する作業員を選択'}
                        </button>
                    </div>

                    <div className="overflow-x-auto">
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
                                    <th className="p-3 font-bold rounded-r-lg">作業員名</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredSummaryData.length === 0 ? (
                                    <tr>
                                        <td colSpan="2" className="p-8 text-center text-slate-400 font-bold">まだ作業実績がありません</td>
                                    </tr>
                                ) : (
                                    filteredSummaryData.map((data, idx) => (
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
                                            <td className="p-3 font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap">
                                                <User size={16} className="text-slate-400" /> {data.name}
                                                {workers.find(w => w.name === data.name)?.birthDate && (
                                                    <span className="text-xs font-normal text-slate-500">
                                                        ({calculateAge(workers.find(w => w.name === data.name).birthDate)}歳)
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(WorkersTab);
