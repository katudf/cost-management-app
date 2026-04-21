import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Loader2, Upload, Trash, PlusCircle, Trash2, Clipboard, Table as TableIcon, ExternalLink, PauseCircle, X } from 'lucide-react';
import { DEFAULT_COLORS } from '../../utils/constants';
import { supabase } from '../../lib/supabase';
import { useToast } from '../Toast';
import DashboardTab from './DashboardTab';
import InputTab from './InputTab';
import ConfirmModal from '../ConfirmModal';

const MasterTab = ({
    activeProject,
    isLoading,
    handleExcelImport,
    fileInputRef,
    removeProject,
    updateLayer,
    handleSiteNameBlur,
    handleProjectStatusChange,
    handleForemanChange,
    handleProjectDateChange,
    workers,
    customers = [],
    updateMasterItemLocal,
    saveMasterItemDB,
    removeMasterItem,
    addMasterItem,
    HOURLY_WAGE,
    // Props for DashboardTab
    summaryData,
    saveProgressDB,
    handleExportToExcel,
    // Props for InputTab
    addRecord,
    updateRecordField,
    removeRecord,
    focusedWorkerRow,
    setFocusedWorkerRow,
    addSubcontractorRecord,
    updateSubcontractorRecordField,
    removeSubcontractorRecord,
    // Deletion Modal Props
    isDeleteModalOpen,
    setIsDeleteModalOpen,
    confirmRemoveProject
}) => {
    const [subActiveTab, setSubActiveTab] = useState('settings');
    const { showToast } = useToast();
    const [suspensions, setSuspensions] = useState([]);
    const [newSuspension, setNewSuspension] = useState({ start_date: '', end_date: '', reason: '' });

    // 休工期間データの取得
    const fetchSuspensions = useCallback(async () => {
        if (!activeProject?.id) return;
        const { data, error } = await supabase
            .from('ProjectSuspensions')
            .select('*')
            .eq('project_id', activeProject.id)
            .order('start_date', { ascending: true });
        if (!error) setSuspensions(data || []);
    }, [activeProject?.id]);

    useEffect(() => {
        fetchSuspensions();
    }, [fetchSuspensions]);

    // 休工期間の追加
    const addSuspension = async () => {
        if (!newSuspension.start_date || !newSuspension.end_date) {
            showToast('開始日と終了日を入力してください', 'error');
            return;
        }
        if (newSuspension.start_date > newSuspension.end_date) {
            showToast('終了日は開始日以降にしてください', 'error');
            return;
        }
        const { error } = await supabase
            .from('ProjectSuspensions')
            .insert({
                project_id: activeProject.id,
                start_date: newSuspension.start_date,
                end_date: newSuspension.end_date,
                reason: newSuspension.reason || ''
            });
        if (error) {
            showToast('休工期間の追加に失敗しました', 'error');
        } else {
            showToast('休工期間を追加しました', 'success');
            setNewSuspension({ start_date: '', end_date: '', reason: '' });
            fetchSuspensions();
        }
    };

    // 休工期間の削除
    const removeSuspension = async (id) => {
        const { error } = await supabase
            .from('ProjectSuspensions')
            .delete()
            .eq('id', id);
        if (error) {
            showToast('削除に失敗しました', 'error');
        } else {
            showToast('休工期間を削除しました', 'success');
            fetchSuspensions();
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* サブナビゲーション */}
            <div className="bg-white border-b border-slate-200 px-6 py-2 flex gap-4 shadow-sm z-10 sticky top-0">
                {[
                    { key: 'settings', label: '工事基本設定', Icon: Settings },
                    { key: 'summary', label: '管理シート', Icon: TableIcon },
                    { key: 'input', label: '実績入力', Icon: Clipboard },
                ].map(({ key, label, Icon }) => (
                    <button
                        key={key}
                        onClick={() => setSubActiveTab(key)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                            subActiveTab === key
                                ? 'bg-blue-50 text-blue-600 shadow-sm'
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                        }`}
                    >
                        <Icon size={18} />
                        {label}
                    </button>
                ))}
                <a
                    href="/?mode=worker"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                >
                    <ExternalLink size={18} />
                    作業日報
                </a>
            </div>

            <div className={`flex-1 overflow-auto ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                {subActiveTab === 'settings' && (
                    <div className="p-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                            <h2 className="text-lg font-bold flex items-center gap-2 text-slate-700"><Settings size={20} /> 見積仕様・目標工数設定</h2>
                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={() => removeProject(activeProject.id)} className="text-red-500 bg-red-50 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-red-100 transition border border-red-200">
                                    <Trash size={16} /> 現場を削除
                                </button>
                            </div>
                        </div>
                        <div className="mb-6 bg-blue-50 p-6 rounded-xl border-2 border-blue-100 shadow-inner">
                            <label className="text-xs font-bold text-blue-600 block mb-2 uppercase">管理現場名</label>
                            <input
                                type="text"
                                value={activeProject.siteName}
                                onChange={(e) => updateLayer(p => ({ siteName: e.target.value }))}
                                onBlur={(e) => handleSiteNameBlur(activeProject.id, e.target.value)}
                                className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-xl outline-none focus:border-blue-500 mb-4"
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="text-xs font-bold text-blue-600 block mb-2 uppercase">現場ステータス</label>
                                    <select
                                        value={activeProject.status || '見積'}
                                        onChange={(e) => handleProjectStatusChange(activeProject.id, e.target.value)}
                                        className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-lg outline-none focus:border-blue-500"
                                    >
                                        <option value="見積">見積</option>
                                        <option value="予定">予定</option>
                                        <option value="施工中">施工中</option>
                                        <option value="完了">完了</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-blue-600 block mb-2 uppercase">担当職長</label>
                                    <select
                                        value={activeProject.foreman_worker_id || ''}
                                        onChange={(e) => handleForemanChange(activeProject.id, e.target.value)}
                                        className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-lg outline-none focus:border-blue-500"
                                    >
                                        <option value="">(未設定）</option>
                                        {workers.filter(w => !w.resignation_date).map(w => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="text-xs font-bold text-blue-600 block mb-2 uppercase">顧客名</label>
                                    <select
                                        value={activeProject.customerId || ''}
                                        onChange={(e) => handleProjectDateChange(activeProject.id, 'customerId', e.target.value ? Number(e.target.value) : null)}
                                        className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-lg outline-none focus:border-blue-500"
                                    >
                                        <option value="">(未設定）</option>
                                        {customers.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-end pb-3">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={activeProject.is_prime_contractor || false}
                                            onChange={(e) => handleProjectDateChange(activeProject.id, 'is_prime_contractor', e.target.checked)}
                                            className="w-5 h-5 rounded border-2 border-blue-200 text-blue-600 focus:ring-blue-500 transition cursor-pointer"
                                        />
                                        <span className="text-sm font-bold text-slate-700 group-hover:text-blue-600 transition">元請</span>
                                    </label>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-blue-600 block mb-2 uppercase">工期 開始日</label>
                                    <input
                                        type="date"
                                        value={activeProject.startDate || ''}
                                        onChange={(e) => {
                                            handleProjectDateChange(activeProject.id, 'startDate', e.target.value || null);
                                        }}
                                        className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-lg outline-none focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-blue-600 block mb-2 uppercase">工期 終了日</label>
                                    <input
                                        type="date"
                                        value={activeProject.endDate || ''}
                                        onChange={(e) => {
                                            handleProjectDateChange(activeProject.id, 'endDate', e.target.value || null);
                                        }}
                                        className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-lg outline-none focus:border-blue-500"
                                    />
                                </div>
                            </div>

                            {/* 休工期間セクション */}
                            <div className="mt-6 pt-4 border-t-2 border-blue-100">
                                <h3 className="text-xs font-bold text-orange-600 mb-3 uppercase flex items-center gap-1.5">
                                    <PauseCircle size={14} /> 休工期間
                                </h3>
                                {suspensions.length > 0 && (
                                    <div className="space-y-2 mb-4">
                                        {suspensions.map(s => (
                                            <div key={s.id} className="flex items-center gap-3 bg-orange-50 p-3 rounded-lg border border-orange-200">
                                                <div className="flex-1 flex items-center gap-2 text-sm font-bold text-orange-800">
                                                    <span>{s.start_date?.replace(/-/g, '/')}</span>
                                                    <span className="text-orange-400">〜</span>
                                                    <span>{s.end_date?.replace(/-/g, '/')}</span>
                                                    {s.reason && <span className="text-xs text-orange-500 font-normal ml-2">({s.reason})</span>}
                                                </div>
                                                <button
                                                    onClick={() => removeSuspension(s.id)}
                                                    className="p-1 text-orange-300 hover:text-red-500 hover:bg-red-50 rounded transition"
                                                    title="この休工期間を削除"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-end gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-orange-500 block mb-1">開始日</label>
                                        <input
                                            type="date"
                                            value={newSuspension.start_date}
                                            onChange={(e) => setNewSuspension(prev => ({ ...prev, start_date: e.target.value }))}
                                            className="bg-white p-2 rounded-lg border-2 border-orange-200 text-sm font-bold outline-none focus:border-orange-400"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-orange-500 block mb-1">終了日</label>
                                        <input
                                            type="date"
                                            value={newSuspension.end_date}
                                            onChange={(e) => setNewSuspension(prev => ({ ...prev, end_date: e.target.value }))}
                                            className="bg-white p-2 rounded-lg border-2 border-orange-200 text-sm font-bold outline-none focus:border-orange-400"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-orange-500 block mb-1">理由（任意）</label>
                                        <input
                                            type="text"
                                            value={newSuspension.reason}
                                            onChange={(e) => setNewSuspension(prev => ({ ...prev, reason: e.target.value }))}
                                            placeholder="例: 他現場対応"
                                            className="w-full bg-white p-2 rounded-lg border-2 border-orange-200 text-sm outline-none focus:border-orange-400"
                                        />
                                    </div>
                                    <button
                                        onClick={addSuspension}
                                        className="px-4 py-2 bg-orange-500 text-white rounded-lg font-bold text-sm hover:bg-orange-600 transition flex items-center gap-1 whitespace-nowrap"
                                    >
                                        <PlusCircle size={14} /> 追加
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="grid lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-2 space-y-3">
                                <h3 className="text-sm font-bold text-slate-500 mb-2 uppercase">仕様項目ごとの目標設定</h3>
                                {activeProject.masterData.map((m) => (
                                    <div key={m.id} className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition">
                                        <div className="flex-1">
                                            <label className="text-[9px] font-bold text-slate-400 block mb-1 uppercase tracking-tighter">作業項目 (仕様)</label>
                                            <input
                                                type="text" value={m.task}
                                                className="w-full font-bold text-sm outline-none border-b border-transparent focus:border-blue-300"
                                                onChange={(e) => updateMasterItemLocal(m.id, 'task', e.target.value)}
                                                onBlur={() => saveMasterItemDB(m.id, { name: m.task })}
                                            />
                                        </div>
                                        <div className="w-28 text-right">
                                            <label className="text-[9px] font-bold text-slate-400 block mb-1 uppercase text-right tracking-tighter">見積金額</label>
                                            <div className="flex items-center gap-1 justify-end font-mono font-bold">
                                                <span className="text-slate-400 text-xs">¥</span><input
                                                    type="number" value={m.estimatedAmount || 0}
                                                    className="w-full text-right outline-none bg-slate-50 rounded px-1"
                                                    onChange={(e) => {
                                                        const newEst = Number(e.target.value);
                                                        const newTarget = Math.round(newEst / HOURLY_WAGE);
                                                        updateLayer(p => ({
                                                            masterData: p.masterData.map(item => item.id === m.id ? { ...item, estimatedAmount: newEst, target: newTarget } : item)
                                                        }));
                                                    }}
                                                    onBlur={() => saveMasterItemDB(m.id, { estimated_amount: m.estimatedAmount || 0, target_hours: m.target })}
                                                />
                                            </div>
                                        </div>
                                        <div className="w-24 text-right">
                                            <label className="text-[9px] font-bold text-slate-400 block mb-1 uppercase text-right tracking-tighter">目標時間</label>
                                            <div className="flex items-center gap-1 justify-end font-mono font-bold">
                                                <input
                                                    type="number" value={m.target}
                                                    className="w-full text-right outline-none bg-slate-50 rounded px-1 cursor-not-allowed opacity-70"
                                                    readOnly
                                                    title="見積金額から自動計算されます"
                                                /><span>h</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeMasterItem(m.id)}
                                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                                            title="この項目を削除"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                ))}

                                <button
                                    onClick={addMasterItem}
                                    className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 font-bold hover:bg-slate-50 hover:border-blue-400 hover:text-blue-600 transition flex justify-center items-center gap-2 mt-4"
                                >
                                    <PlusCircle size={20} /> 新しい作業項目を追加
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {subActiveTab === 'summary' && (
                    <DashboardTab
                        activeProject={activeProject}
                        summaryData={summaryData}
                        updateLayer={updateLayer}
                        saveProgressDB={saveProgressDB}
                        handleExportToExcel={handleExportToExcel}
                        isLoading={isLoading}
                    />
                )}

                {subActiveTab === 'input' && (
                    <InputTab
                        activeProject={activeProject}
                        isLoading={isLoading}
                        addRecord={addRecord}
                        updateRecordField={updateRecordField}
                        removeRecord={removeRecord}
                        workers={workers}
                        focusedWorkerRow={focusedWorkerRow}
                        setFocusedWorkerRow={setFocusedWorkerRow}
                        addSubcontractorRecord={addSubcontractorRecord}
                        updateSubcontractorRecordField={updateSubcontractorRecordField}
                        removeSubcontractorRecord={removeSubcontractorRecord}
                    />
                )}
            </div>

            <ConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={confirmRemoveProject}
                title="現場の削除"
                message={`「${activeProject.siteName || '無題の現場'}」のデータをすべて削除しますか？\nこの操作は取り消せません。`}
            />
        </div>
    );
};

export default React.memo(MasterTab);
