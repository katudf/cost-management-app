import React, { useState } from 'react';
import { Users, Settings, Plus, ArrowUp, ArrowDown, Calendar, BarChart3, User, ChevronRight } from 'lucide-react';
import { calculateAge } from '../../utils/dateUtils';
import WorkerDetailsModal from '../WorkerDetailsModal';

const WorkersTab = ({
    isLoading,
    workers,
    addWorker,
    moveWorkerOrder,
    openEditWorkerModal,
    removeWorker,
    workerSummaryData,
    setExportModalWorker
}) => {
    const [selectedWorkerForDetails, setSelectedWorkerForDetails] = useState(null);

    return (
        <div className={`p-6 bg-slate-50 min-h-[500px] ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <WorkerDetailsModal 
                isOpen={!!selectedWorkerForDetails}
                worker={workers.find(w => w.id === selectedWorkerForDetails)}
                onClose={() => setSelectedWorkerForDetails(null)}
                onEdit={openEditWorkerModal}
                onDelete={removeWorker}
            />
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users className="text-blue-600" /> 作業員管理・稼働確認</h2>
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
                        {workers.map((worker, idx) => (
                            <div 
                                key={worker.id}
                                className="flex flex-col sm:flex-row items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-white transition group gap-2 cursor-pointer"
                                onClick={() => setSelectedWorkerForDetails(worker.id)}
                            >
                                <div className="flex items-center gap-3 w-full sm:w-auto">
                                    <div className="flex flex-col">
                                        <button
                                            disabled={idx === 0}
                                            onClick={(e) => { e.stopPropagation(); moveWorkerOrder(idx, -1); }}
                                            className="text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-300 p-0.5"
                                        >
                                            <ArrowUp size={16} />
                                        </button>
                                        <button
                                            disabled={idx === workers.length - 1}
                                            onClick={(e) => { e.stopPropagation(); moveWorkerOrder(idx, 1); }}
                                            className="text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-300 p-0.5"
                                        >
                                            <ArrowDown size={16} />
                                        </button>
                                    </div>
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
                        {workers.length === 0 && (
                            <div className="text-center py-8 text-slate-400 font-bold text-sm">作業員が登録されていません</div>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-4 leading-relaxed">
                        ※ここでの表示順（上から順）が、作業員アプリ（スマホ側）のログイン画面や実績入力時のリストの順番になります。
                    </p>
                </div>

                {/* 右側：稼働実績の集計 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 h-fit">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
                        <BarChart3 size={18} className="text-slate-400" />
                        作業員別 稼働時間集計 (全期間)
                    </h3>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-slate-100 text-slate-600 text-xs tracking-wider uppercase">
                                    <th className="p-3 font-bold rounded-l-lg">作業員名</th>
                                    <th className="p-3 font-bold">稼働した現場</th>
                                    <th className="p-3 font-bold text-right">総稼働時間</th>
                                    <th className="p-3 font-bold text-center rounded-r-lg">日報</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {workerSummaryData.length === 0 ? (
                                    <tr>
                                        <td colSpan="3" className="p-8 text-center text-slate-400 font-bold">まだ作業実績がありません</td>
                                    </tr>
                                ) : (
                                    workerSummaryData.map((data, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 transition">
                                            <td className="p-3 font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap">
                                                <User size={16} className="text-slate-400" /> {data.name}
                                                {workers.find(w => w.name === data.name)?.birthDate && (
                                                    <span className="text-xs font-normal text-slate-500">
                                                        ({calculateAge(workers.find(w => w.name === data.name).birthDate)}歳)
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {data.projects.map((site, sIdx) => (
                                                        <span key={sIdx} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100">
                                                            {site}
                                                        </span>
                                                    ))}
                                                    {data.projects.length === 0 && <span className="text-[10px] text-slate-400">-</span>}
                                                </div>
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="font-mono font-bold text-lg text-slate-700">
                                                    {data.totalHours.toFixed(1)} <span className="text-xs text-slate-500 font-sans">h</span>
                                                </div>
                                            </td>
                                            <td className="p-3 text-center">
                                                <button
                                                    onClick={() => setExportModalWorker(data.name)}
                                                    className="text-[11px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 font-bold py-1.5 px-3 border border-slate-300 hover:border-blue-400 rounded-lg transition"
                                                >
                                                    出力
                                                </button>
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

export default WorkersTab;
