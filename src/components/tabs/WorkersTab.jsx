import React, { useState, useMemo } from 'react';
import { Users, Settings, Plus, Calendar, User, ChevronRight } from 'lucide-react';
import { calculateAge } from '../../utils/dateUtils';
import { WORKER_TYPE } from '../../utils/constants';
import WorkerDetailsModal from '../WorkerDetailsModal';

const WorkersTab = ({
    isLoading,
    workers,
    addWorker,
    handleWorkerReorder,
    openEditWorkerModal,
    removeWorker,
}) => {
    const [selectedWorkerForDetails, setSelectedWorkerForDetails] = useState(null);
    const [showResigned, setShowResigned] = useState(false);

    const filteredWorkers = useMemo(() => {
        if (showResigned) return workers;
        return (workers || []).filter(w => !w.resignation_date);
    }, [workers, showResigned]);

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

            <div className="grid grid-cols-1 gap-6">
                {/* マスター管理（名簿・順番） */}
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
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${worker.worker_type === WORKER_TYPE.OFFICE ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {worker.worker_type || WORKER_TYPE.WORKER}
                                    </span>
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

            </div>
        </div>
    );
};

export default React.memo(WorkersTab);
