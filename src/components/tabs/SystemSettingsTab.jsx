import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Settings, Save, CheckCircle2, Award, Plus, Edit3, Trash2, X, ChevronDown, ChevronRight, Activity } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import { getDailyApiUsage } from '../../utils/aiOptimizeUtils';
import HolidayCalendar from '../HolidayCalendar';

const SystemSettingsTab = ({ hourlyWage, setHourlyWage, geminiApiKey, setGeminiApiKey, isLoading, setIsLoading, workers = [], fetchAllData }) => {
    const { showToast } = useToast();
    const [localWage, setLocalWage] = useState(hourlyWage);
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [certForm, setCertForm] = useState({ id: null, workerId: '', name: '', registrationNumber: '', acquisitionDate: '', expiryDate: '' });
    const [expandedWorkers, setExpandedWorkers] = useState({});
    const [apiUsage, setApiUsage] = useState(null);
    const [certNameMaster, setCertNameMaster] = useState([]);
    const [isCustomCertName, setIsCustomCertName] = useState(false);
    const [viewMode, setViewMode] = useState('worker'); // 'worker' or 'cert'

    useEffect(() => {
        setApiUsage(getDailyApiUsage());
    }, []);

    // 資格名マスター取得
    const fetchCertNameMaster = useCallback(async () => {
        try {
            const { data } = await supabase.from('CertificationNames').select('*').order('name', { ascending: true });
            setCertNameMaster(data || []);
        } catch (e) {
            console.error('資格名マスター取得エラー:', e);
        }
    }, []);

    useEffect(() => {
        fetchCertNameMaster();
    }, [fetchCertNameMaster]);

    const certsByWorker = useMemo(() => {
        const groups = {};
        workers.forEach(w => {
            if (w.certifications && w.certifications.length > 0) {
                groups[w.id] = {
                    workerId: w.id,
                    workerName: w.name,
                    // id順で並べることで最初に登録したものを一番上にする
                    certs: [...w.certifications].sort((a, b) => a.id - b.id)
                };
            }
        });
        return Object.values(groups).sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja'));
    }, [workers]);

    const certsByName = useMemo(() => {
        const groups = {};
        workers.forEach(w => {
            (w.certifications || []).forEach(cert => {
                if (!groups[cert.name]) {
                    groups[cert.name] = {
                        name: cert.name,
                        holders: []
                    };
                }
                groups[cert.name].holders.push({
                    ...cert,
                    workerName: w.name,
                    workerId: w.id
                });
            });
        });
        // 資格名でソート
        return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [workers]);

    const toggleWorker = (workerId) => {
        setExpandedWorkers(prev => ({
            ...prev,
            [workerId]: !prev[workerId]
        }));
    };

    const handleSaveCert = async () => {
        setIsSaving(true);
        setIsLoading(true);
        try {
            const trimmedName = certForm.name.trim();

            // 重複チェック
            const targetWorker = workers.find(w => w.id === Number(certForm.workerId));
            if (targetWorker && targetWorker.certifications) {
                const isDuplicate = targetWorker.certifications.some(c => 
                    c.name === trimmedName && c.id !== certForm.id
                );
                if (isDuplicate) {
                    showToast(`「${targetWorker.name}」さんは既に「${trimmedName}」を登録済みです。`, 'error');
                    setIsSaving(false);
                    setIsLoading(false);
                    return;
                }
            }

            const payload = {
                workerId: Number(certForm.workerId),
                name: trimmedName,
                registrationNumber: certForm.registrationNumber || null,
                acquisitionDate: certForm.acquisitionDate || null,
                expiryDate: certForm.expiryDate || null
            };

            if (certForm.id) {
                const { error } = await supabase.from('WorkerCertifications').update(payload).eq('id', certForm.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('WorkerCertifications').insert([payload]);
                if (error) throw error;
            }

            // 資格名マスターに未登録なら自動追加
            if (trimmedName && !certNameMaster.some(m => m.name === trimmedName)) {
                await supabase.from('CertificationNames').insert([{ name: trimmedName }]);
                await fetchCertNameMaster();
            }

            setCertForm({ id: null, workerId: '', name: '', registrationNumber: '', acquisitionDate: '', expiryDate: '' });
            setIsCustomCertName(false);
            if (fetchAllData) await fetchAllData();
        } catch (error) {
            console.error('資格保存エラー:', error);
            showToast('保存に失敗しました: ' + error.message, 'error');
        } finally {
            setIsSaving(false);
            setIsLoading(false);
        }
    };

    const handleDeleteCert = async (certId) => {
        if (!window.confirm('この資格情報を削除しますか？')) return;
        setIsSaving(true);
        setIsLoading(true);
        try {
            const { error } = await supabase.from('WorkerCertifications').delete().eq('id', certId);
            if (error) throw error;
            if (fetchAllData) await fetchAllData();
        } catch (error) {
            console.error('資格削除エラー:', error);
            showToast('削除に失敗しました: ' + error.message, 'error');
        } finally {
            setIsSaving(false);
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('system_settings')
                .update({ hourly_wage: localWage, updated_at: new Date().toISOString() })
                .eq('id', 1);

            if (error) throw error;

            setHourlyWage(localWage);
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        } catch (error) {
            console.error('設定の保存に失敗しました:', error);
            showToast('設定の保存に失敗しました: ' + error.message, 'error');
        } finally {
            setIsSaving(false);
            setIsLoading(false);
        }
    };

    return (
        <div className={`p-6 bg-slate-50 min-h-[500px] ${isLoading && !isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Settings className="text-slate-600" /> システム共通設定
                </h2>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-2xl">
                <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                        1人あたりの人工費用 (円/時間)
                    </label>
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 max-w-xs">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                            <input
                                type="number"
                                value={localWage}
                                onChange={(e) => setLocalWage(Number(e.target.value))}
                                className="w-full pl-8 pl-8 pr-4 py-3 rounded-lg border-2 border-slate-200 font-bold text-lg outline-none focus:border-blue-500 transition"
                            />
                        </div>
                        <span className="text-slate-500 text-sm font-bold">円 / 1時間</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                        現在入力中の値: 1日(8時間)あたり <strong>¥{(localWage * 8).toLocaleString()}</strong> 相当
                    </p>
                </div>

                <div className="mb-6 pt-6 border-t border-slate-100">
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                        Gemini API キー (Excel自動最適化機能用)
                    </label>
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            {geminiApiKey ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-50 text-green-700 font-bold border border-green-200">
                                    <CheckCircle2 size={16} /> 設定済み
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 text-slate-500 font-bold border border-slate-200">
                                    未設定
                                </span>
                            )}
                            <p className="text-xs text-slate-500">
                                ※APIキーはセキュリティのため <code>.env</code> ファイル（<code>VITE_GEMINI_API_KEY</code>）にて管理されます。<br/>
                                ※設定すると、対象のExcelインポート時に見積項目名の自動短縮や不要項目の除外機能が利用可能になります。
                            </p>
                        </div>

                        {apiUsage && (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
                                <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                    <Activity size={16} className="text-blue-500" />
                                    本日のAPI利用状況 (ローカル集計)
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white p-3 rounded border border-slate-100 flex flex-col">
                                        <span className="text-xs font-bold text-slate-500 mb-1">リクエスト回数</span>
                                        <div className="flex items-end gap-1">
                                            <span className={`text-xl font-bold ${apiUsage.requestCount >= apiUsage.limitRequests * 0.8 ? 'text-red-500' : 'text-slate-800'}`}>
                                                {apiUsage.requestCount.toLocaleString()}
                                            </span>
                                            <span className="text-xs text-slate-400 mb-1">/ {apiUsage.limitRequests.toLocaleString()} 回</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 mt-2 rounded-full overflow-hidden">
                                            <div className={`h-full ${apiUsage.requestCount >= apiUsage.limitRequests * 0.8 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, (apiUsage.requestCount / apiUsage.limitRequests) * 100)}%` }} />
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded border border-slate-100 flex flex-col">
                                        <span className="text-xs font-bold text-slate-500 mb-1">消費トークン数</span>
                                        <div className="flex items-end gap-1">
                                            <span className={`text-xl font-bold ${apiUsage.totalTokens >= apiUsage.limitTokens * 0.8 ? 'text-red-500' : 'text-slate-800'}`}>
                                                {apiUsage.totalTokens.toLocaleString()}
                                            </span>
                                            <span className="text-xs text-slate-400 mb-1">/ {(apiUsage.limitTokens / 10000).toLocaleString()}万</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 mt-2 rounded-full overflow-hidden">
                                            <div className={`h-full ${apiUsage.totalTokens >= apiUsage.limitTokens * 0.8 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, (apiUsage.totalTokens / apiUsage.limitTokens) * 100)}%` }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4 pt-4 border-t border-slate-100">
                    <button
                        onClick={handleSave}
                        disabled={isSaving || localWage === hourlyWage}
                        className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save size={18} />
                        {isSaving ? '保存中...' : '設定を保存する'}
                    </button>

                    {showSuccess && (
                        <span className="text-green-600 font-bold text-sm flex items-center gap-1 animate-fade-in">
                            <CheckCircle2 size={16} /> 保存しました
                        </span>
                    )}
                </div>
            </div>

            {/* 会社休日カレンダー */}
            <HolidayCalendar />

            {/* 資格情報マスター */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-4xl mt-6">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Award className="text-blue-500" />
                        資格情報マスター
                    </h3>
                    <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                        <button
                            onClick={() => setViewMode('worker')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'worker' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            作業員別
                        </button>
                        <button
                            onClick={() => setViewMode('cert')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'cert' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            資格別
                        </button>
                    </div>
                </div>

                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 mb-6 shadow-sm">
                    <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                        {certForm.id ? <Edit3 size={18} className="text-blue-600" /> : <Plus size={18} className="text-green-600" />}
                        {certForm.id ? '資格情報の編集' : '新規資格の追加'}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">作業員名 <span className="text-red-500">*</span></label>
                            <select
                                value={certForm.workerId}
                                onChange={(e) => setCertForm({ ...certForm, workerId: e.target.value })}
                                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm bg-white font-bold text-slate-700 outline-none focus:border-blue-500 transition cursor-pointer"
                            >
                                <option value="">選択してください</option>
                                {workers.map(w => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">資格名 <span className="text-red-500">*</span></label>
                            {isCustomCertName ? (
                                <div className="flex gap-1">
                                    <input
                                        type="text"
                                        value={certForm.name}
                                        onChange={(e) => setCertForm({ ...certForm, name: e.target.value })}
                                        className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm bg-white font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                        placeholder="新しい資格名を入力"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setIsCustomCertName(false); setCertForm({ ...certForm, name: '' }); }}
                                        className="px-2 py-1 text-xs text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition whitespace-nowrap"
                                        title="一覧から選択に戻る"
                                    >
                                        戻る
                                    </button>
                                </div>
                            ) : (
                                <select
                                    value={certForm.name}
                                    onChange={(e) => {
                                        if (e.target.value === '__custom__') {
                                            setIsCustomCertName(true);
                                            setCertForm({ ...certForm, name: '' });
                                        } else {
                                            setCertForm({ ...certForm, name: e.target.value });
                                        }
                                    }}
                                    className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm bg-white font-bold text-slate-700 outline-none focus:border-blue-500 transition cursor-pointer"
                                >
                                    <option value="">選択してください</option>
                                    {certNameMaster.map(cn => (
                                        <option key={cn.id} value={cn.name}>{cn.name}</option>
                                    ))}
                                    <option value="__custom__">＋ 新しい資格名を入力...</option>
                                </select>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">登録番号</label>
                            <input
                                type="text"
                                value={certForm.registrationNumber || ''}
                                onChange={(e) => setCertForm({ ...certForm, registrationNumber: e.target.value })}
                                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm bg-white text-slate-700 outline-none focus:border-blue-500 transition"
                                placeholder="例: 12345678"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">取得日</label>
                            <input
                                type="date"
                                value={certForm.acquisitionDate}
                                onChange={(e) => setCertForm({ ...certForm, acquisitionDate: e.target.value })}
                                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm bg-white text-slate-700 outline-none focus:border-blue-500 transition"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">有効期限</label>
                            <input
                                type="date"
                                value={certForm.expiryDate}
                                onChange={(e) => setCertForm({ ...certForm, expiryDate: e.target.value })}
                                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm bg-white text-slate-700 outline-none focus:border-blue-500 transition"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                        {certForm.id && (
                            <button
                                onClick={() => setCertForm({ id: null, workerId: '', name: '', registrationNumber: '', acquisitionDate: '', expiryDate: '' })}
                                disabled={isSaving}
                                className="px-5 py-2.5 rounded-lg font-bold text-sm text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 transition flex items-center gap-1 disabled:opacity-50"
                            >
                                <X size={16} /> キャンセル
                            </button>
                        )}
                        <button
                            onClick={handleSaveCert}
                            disabled={!certForm.workerId || !certForm.name || isSaving}
                            className="px-5 py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Save size={16} /> {certForm.id ? '更新する' : '追加する'}
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wider">
                                <th className="p-4 font-bold border-b border-slate-200">{viewMode === 'worker' ? '作業員名' : '資格名'}</th>
                                <th className="p-4 font-bold border-b border-slate-200">{viewMode === 'worker' ? '資格名' : '保持者'}</th>
                                <th className="p-4 font-bold border-b border-slate-200">登録番号</th>
                                <th className="p-4 font-bold border-b border-slate-200">取得日</th>
                                <th className="p-4 font-bold border-b border-slate-200">有効期限</th>
                                <th className="p-4 font-bold border-b border-slate-200 text-center">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {viewMode === 'worker' ? (
                                certsByWorker.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-slate-400 font-bold text-sm bg-white">
                                            登録されている資格情報はありません
                                        </td>
                                    </tr>
                                ) : (
                                    certsByWorker.map(group => {
                                        const firstCert = group.certs[0];
                                        const hasMore = group.certs.length > 1;
                                        const isExpanded = expandedWorkers[group.workerId];

                                        return (
                                            <React.Fragment key={group.workerId}>
                                                <tr className={`bg-white transition ${certForm.id === firstCert.id ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                                                    <td className="p-4 font-bold text-sm text-slate-800">
                                                        <div 
                                                            className={`flex items-center gap-2 ${hasMore ? 'cursor-pointer hover:text-blue-600 group' : ''}`}
                                                            onClick={() => hasMore && toggleWorker(group.workerId)}
                                                            title={hasMore ? 'クリックして他の資格を表示/非表示' : ''}
                                                        >
                                                            {hasMore && (
                                                                <span className="text-slate-400 group-hover:text-blue-500 transition-colors">
                                                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                                </span>
                                                            )}
                                                            {!hasMore && <div className="w-[18px]" />}
                                                            {group.workerName}
                                                            {hasMore && (
                                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-200 transition">
                                                                    他{group.certs.length - 1}件
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 font-bold text-sm text-slate-800">{firstCert.name}</td>
                                                    <td className="p-4 text-sm text-slate-500 font-mono">{firstCert.registrationNumber || '-'}</td>
                                                    <td className="p-4 text-sm text-slate-500 font-mono">{firstCert.acquisitionDate ? firstCert.acquisitionDate.replace(/-/g, '/') : '-'}</td>
                                                    <td className="p-4 text-sm text-slate-500 font-mono">{firstCert.expiryDate ? firstCert.expiryDate.replace(/-/g, '/') : '-'}</td>
                                                    <td className="p-4 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                onClick={() => setCertForm({ id: firstCert.id, workerId: firstCert.workerId || group.workerId, name: firstCert.name, registrationNumber: firstCert.registrationNumber || '', acquisitionDate: firstCert.acquisitionDate || '', expiryDate: firstCert.expiryDate || '' })}
                                                                disabled={isSaving}
                                                                className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                title="編集"
                                                            >
                                                                <Edit3 size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteCert(firstCert.id)}
                                                                disabled={isSaving}
                                                                className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                title="削除"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && group.certs.slice(1).map(cert => (
                                                    <tr key={cert.id} className={`bg-slate-50/50 transition ${certForm.id === cert.id ? 'bg-blue-100/50' : 'hover:bg-slate-100/50'}`}>
                                                        <td className="p-4 font-bold text-sm text-slate-400 text-right pr-6 align-middle">
                                                            <div className="flex justify-end">
                                                                <div className="border-l-2 border-b-2 border-slate-300 w-3 h-3 rounded-bl-sm mr-2 mb-1 opacity-70"></div>
                                                            </div>
                                                        </td>
                                                        <td className="p-4 font-bold text-sm text-slate-700">{cert.name}</td>
                                                        <td className="p-4 text-sm text-slate-500 font-mono">{cert.registrationNumber || '-'}</td>
                                                        <td className="p-4 text-sm text-slate-500 font-mono">{cert.acquisitionDate ? cert.acquisitionDate.replace(/-/g, '/') : '-'}</td>
                                                        <td className="p-4 text-sm text-slate-500 font-mono">{cert.expiryDate ? cert.expiryDate.replace(/-/g, '/') : '-'}</td>
                                                        <td className="p-4 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button
                                                                    onClick={() => setCertForm({ id: cert.id, workerId: cert.workerId || group.workerId, name: cert.name, registrationNumber: cert.registrationNumber || '', acquisitionDate: cert.acquisitionDate || '', expiryDate: cert.expiryDate || '' })}
                                                                    disabled={isSaving}
                                                                    className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                    title="編集"
                                                                >
                                                                    <Edit3 size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteCert(cert.id)}
                                                                    disabled={isSaving}
                                                                    className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                    title="削除"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        );
                                    })
                                )
                            ) : (
                                // 資格別表示モード
                                certsByName.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-slate-400 font-bold text-sm bg-white">
                                            登録されている資格情報はありません
                                        </td>
                                    </tr>
                                ) : (
                                    certsByName.map(group => {
                                        const firstHolder = group.holders[0];
                                        const hasMore = group.holders.length > 1;
                                        const isExpanded = expandedWorkers[`cert_${group.name}`];

                                        return (
                                            <React.Fragment key={group.name}>
                                                <tr className="bg-white hover:bg-slate-50 transition">
                                                    <td className="p-4 font-bold text-sm text-slate-800">
                                                        <div 
                                                            className={`flex items-center gap-2 ${hasMore ? 'cursor-pointer hover:text-blue-600 group' : ''}`}
                                                            onClick={() => hasMore && toggleWorker(`cert_${group.name}`)}
                                                        >
                                                            {hasMore && (
                                                                <span className="text-slate-400 group-hover:text-blue-500 transition-colors">
                                                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                                </span>
                                                            )}
                                                            {!hasMore && <div className="w-[18px]" />}
                                                            {group.name}
                                                            {hasMore && (
                                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-200 transition">
                                                                    {group.holders.length}名
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 font-bold text-sm text-slate-800">{firstHolder.workerName}</td>
                                                    <td className="p-4 text-sm text-slate-500 font-mono">{firstHolder.registrationNumber || '-'}</td>
                                                    <td className="p-4 text-sm text-slate-500 font-mono">{firstHolder.acquisitionDate ? firstHolder.acquisitionDate.replace(/-/g, '/') : '-'}</td>
                                                    <td className="p-4 text-sm text-slate-500 font-mono">{firstHolder.expiryDate ? firstHolder.expiryDate.replace(/-/g, '/') : '-'}</td>
                                                    <td className="p-4 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                onClick={() => setCertForm({ id: firstHolder.id, workerId: firstHolder.workerId, name: group.name, registrationNumber: firstHolder.registrationNumber || '', acquisitionDate: firstHolder.acquisitionDate || '', expiryDate: firstHolder.expiryDate || '' })}
                                                                disabled={isSaving}
                                                                className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                title="編集"
                                                            >
                                                                <Edit3 size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteCert(firstHolder.id)}
                                                                disabled={isSaving}
                                                                className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                title="削除"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && group.holders.slice(1).map(holder => (
                                                    <tr key={holder.id} className="bg-slate-50/50 hover:bg-slate-100/50 transition">
                                                        <td className="p-4 font-bold text-sm text-slate-400 text-right pr-6 align-middle">
                                                            <div className="flex justify-end">
                                                                <div className="border-l-2 border-b-2 border-slate-300 w-3 h-3 rounded-bl-sm mr-2 mb-1 opacity-70"></div>
                                                            </div>
                                                        </td>
                                                        <td className="p-4 font-bold text-sm text-slate-700">{holder.workerName}</td>
                                                        <td className="p-4 text-sm text-slate-500 font-mono">{holder.registrationNumber || '-'}</td>
                                                        <td className="p-4 text-sm text-slate-500 font-mono">{holder.acquisitionDate ? holder.acquisitionDate.replace(/-/g, '/') : '-'}</td>
                                                        <td className="p-4 text-sm text-slate-500 font-mono">{holder.expiryDate ? holder.expiryDate.replace(/-/g, '/') : '-'}</td>
                                                        <td className="p-4 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button
                                                                    onClick={() => setCertForm({ id: holder.id, workerId: holder.workerId, name: group.name, registrationNumber: holder.registrationNumber || '', acquisitionDate: holder.acquisitionDate || '', expiryDate: holder.expiryDate || '' })}
                                                                    disabled={isSaving}
                                                                    className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                    title="編集"
                                                                >
                                                                    <Edit3 size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteCert(holder.id)}
                                                                    disabled={isSaving}
                                                                    className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                                    title="削除"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        );
                                    })
                                )
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default React.memo(SystemSettingsTab);

