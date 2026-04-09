import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Loader2, LogOut, HardHat, CheckCircle2, AlertCircle, Save, Trash2, PlusCircle } from 'lucide-react';
import { useToast } from './components/Toast';

const WorkerApp = () => {
    const { showToast } = useToast();
    const [workers, setWorkers] = useState([]);
    const [loggedInWorker, setLoggedInWorker] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [projects, setProjects] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [tasks, setTasks] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    const [subcontractors, setSubcontractors] = useState([]);
    const [deletedSubcontractorIds, setDeletedSubcontractorIds] = useState([]);

    const [hourlyWage, setHourlyWage] = useState(3500);
    const [allProjectRecords, setAllProjectRecords] = useState([]);
    const [allSubcontractorRecords, setAllSubcontractorRecords] = useState([]);

    // Initial load
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                // Check local storage for saved login
                const savedWorkerStr = localStorage.getItem('cost-app-worker');
                if (savedWorkerStr) {
                    setLoggedInWorker(JSON.parse(savedWorkerStr));
                }

                const savedProjectId = localStorage.getItem('cost-app-worker-project');
                if (savedProjectId) {
                    setSelectedProjectId(savedProjectId);
                }

                // Fetch workers for login screen
                const { data: wData } = await supabase.from('Workers').select('id, name, resignation_date').order('display_order', { ascending: true, nullsFirst: false });
                if (wData) {
                    setWorkers(wData.filter(w => w.name && w.name.trim() !== '' && !w.resignation_date));
                }

                // Fetch active projects
                const { data: pData } = await supabase.from('Projects').select('*').order('created_at', { ascending: true });
                if (pData) {
                    setProjects(pData);
                }

                // Fetch hourly wage
                const { data: settingsData } = await supabase.from('system_settings').select('hourly_wage').eq('id', 1).single();
                if (settingsData && settingsData.hourly_wage) {
                    setHourlyWage(settingsData.hourly_wage);
                }
            } catch (error) {
                console.error('Initialization error:', error);
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, []);

    // Load tasks when project is selected
    useEffect(() => {
        if (!selectedProjectId || !loggedInWorker) {
            setTasks([]);
            return;
        }

        const loadProjectDetails = async () => {
            setIsLoading(true);
            setSaveMessage('');
            try {
                const today = new Date().toISOString().split('T')[0];

                const { data: tData } = await supabase.from('ProjectTasks')
                    .select('*')
                    .eq('projectId', selectedProjectId)
                    .order('order', { ascending: true });

                const { data: rData } = await supabase.from('TaskRecords')
                    .select('*')
                    .eq('project_id', selectedProjectId)
                    .eq('worker_name', loggedInWorker.name)
                    .eq('date', today);

                const { data: sData } = await supabase.from('SubcontractorRecords')
                    .select('*')
                    .eq('project_id', selectedProjectId)
                    .eq('date', today);

                const mappedTasks = (tData || []).map(t => {
                    const todayRecord = (rData || []).find(r => r.project_task_id === t.id);
                    return {
                        id: t.id,
                        name: t.name || '',
                        target_hours: t.target_hours || 0,
                        progress_percentage: t.progress_percentage || 0,

                        today_hours: todayRecord ? todayRecord.hours : 0,
                        today_overtime_hours: todayRecord ? (todayRecord.overtime_hours || 0) : 0,
                        today_record_id: todayRecord ? todayRecord.id : null,
                        today_note: todayRecord ? todayRecord.note : ''
                    };
                });

                setTasks(mappedTasks);
                setSubcontractors(sData || []);
                setDeletedSubcontractorIds([]);

                // Fetch ALL records for foreman calculations
                const project = projects.find(p => p.id === Number(selectedProjectId));
                if (project && project.foreman_worker_id === loggedInWorker.id) {
                    const { data: allRecords } = await supabase.from('TaskRecords').select('*').eq('project_id', selectedProjectId);
                    setAllProjectRecords(allRecords || []);

                    const { data: allSubData } = await supabase.from('SubcontractorRecords').select('*').eq('project_id', selectedProjectId);
                    setAllSubcontractorRecords(allSubData || []);
                } else {
                    setAllProjectRecords([]);
                    setAllSubcontractorRecords([]);
                }
            } catch (error) {
                console.error('Error loading project details:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadProjectDetails();
    }, [selectedProjectId, loggedInWorker]);

    const handleLogin = (worker) => {
        setLoggedInWorker(worker);
        localStorage.setItem('cost-app-worker', JSON.stringify(worker));
    };

    const handleLogout = () => {
        if (window.confirm("ログアウトしますか？")) {
            setLoggedInWorker(null);
            setSelectedProjectId('');
            setTasks([]);
            setSubcontractors([]);
            setDeletedSubcontractorIds([]);
            localStorage.removeItem('cost-app-worker');
            localStorage.removeItem('cost-app-worker-project');
        }
    };

    const updateTaskField = (taskId, field, value) => {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t));
    };

    const adjustHours = (taskId, delta) => {
        setTasks(prev => prev.map(t => {
            if (t.id === taskId) {
                const newHours = Math.max(0, (t.today_hours || 0) + delta);
                return { ...t, today_hours: newHours };
            }
            return t;
        }));
    };

    const addSubcontractor = () => {
        setSubcontractors(prev => [...prev, { id: 'temp-' + Date.now(), company_name: '', worker_count: 1 }]);
    };

    const updateSubcontractor = (id, field, value) => {
        setSubcontractors(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    const removeSubcontractor = (id) => {
        if (!String(id).startsWith('temp-')) {
            setDeletedSubcontractorIds(prev => [...prev, id]);
        }
        setSubcontractors(prev => prev.filter(s => s.id !== id));
    };

    const handleAddNewTask = async () => {
        if (!selectedProjectId) return;
        const taskName = window.prompt("追加する作業項目の名称を入力してください。");
        if (!taskName || taskName.trim() === '') return;

        setIsLoading(true);
        try {
            const newTaskOrder = tasks.length > 0 ? Math.max(...tasks.map(t => t.order || 0)) + 1 : 1;
            const newTask = {
                projectId: selectedProjectId,
                name: taskName.trim(),
                target_hours: 0,
                estimated_amount: 0,
                order: newTaskOrder,
                progress_percentage: 0
            };

            const { data, error } = await supabase.from('ProjectTasks').insert([newTask]).select();
            if (error) throw error;

            if (data && data.length > 0) {
                const inserted = data[0];
                setTasks(prev => [...prev, {
                    id: inserted.id,
                    name: inserted.name,
                    target_hours: inserted.target_hours,
                    progress_percentage: inserted.progress_percentage,
                    order: inserted.order,
                    today_hours: 0,
                    today_overtime_hours: 0,
                    today_record_id: null,
                    today_note: ''
                }]);
            }
        } catch (error) {
            console.error("Failed to add new task:", error);
            showToast('作業項目の追加に失敗しました。', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!selectedProjectId || tasks.length === 0) return;
        setIsSaving(true);
        setSaveMessage('');

        try {
            const today = new Date().toISOString().split('T')[0];
            const project = projects.find(p => p.id === Number(selectedProjectId));
            const isForeman = project && project.foreman_worker_id === loggedInWorker.id;

            for (const t of tasks) {
                // Upsert records
                if (t.today_hours > 0 || t.today_overtime_hours > 0 || t.today_record_id) {
                    if (t.today_record_id) {
                        // Update existing
                        await supabase.from('TaskRecords').update({
                            hours: t.today_hours || 0,
                            overtime_hours: t.today_overtime_hours || 0,
                            note: t.today_note || ''
                        }).eq('id', t.today_record_id);
                    } else if (t.today_hours > 0 || t.today_overtime_hours > 0) {
                        // Insert new
                        const { data } = await supabase.from('TaskRecords').insert([{
                            project_id: selectedProjectId,
                            project_task_id: t.id,
                            date: today,
                            hours: t.today_hours || 0,
                            overtime_hours: t.today_overtime_hours || 0,
                            worker_name: loggedInWorker.name,
                            note: t.today_note || ''
                        }]).select();

                        if (data && data[0]) {
                            t.today_record_id = data[0].id;
                        }
                    }
                }

                // Update progress if foreman
                if (isForeman) {
                    await supabase.from('ProjectTasks').update({
                        progress_percentage: t.progress_percentage
                    }).eq('id', t.id);
                }
            }

            // Subcontractor logic
            if (isForeman) {
                // Delete removed records
                for (const delId of deletedSubcontractorIds) {
                    await supabase.from('SubcontractorRecords').delete().eq('id', delId);
                }

                // Upsert records
                for (const s of subcontractors) {
                    if (!s.company_name) continue;

                    if (String(s.id).startsWith('temp-')) {
                        await supabase.from('SubcontractorRecords').insert([{
                            project_id: selectedProjectId,
                            date: today,
                            company_name: s.company_name,
                            worker_count: s.worker_count,
                            unit_price: 25000,
                            worker_name: loggedInWorker.name
                        }]);
                    } else {
                        await supabase.from('SubcontractorRecords').update({
                            company_name: s.company_name,
                            worker_count: s.worker_count
                        }).eq('id', s.id);
                    }
                }
            }

            setSaveMessage('日報を送信しました！お疲れ様です。');
            setTimeout(() => setSaveMessage(''), 5000);
        } catch (error) {
            console.error('Submit error:', error);
            showToast('保存に失敗しました。電波の良いところで再度お試しください。', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading && !loggedInWorker) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-100"><Loader2 className="w-12 h-12 text-blue-500 animate-spin" /></div>;
    }

    // ========== ログイン画面 ==========
    if (!loggedInWorker) {
        return (
            <div className="min-h-screen bg-slate-100 flex flex-col items-center p-4">
                <div className="w-full max-w-sm mt-10">
                    <div className="bg-white rounded-2xl shadow-lg p-6 text-center border-t-4 border-blue-600">
                        <HardHat className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                        <h1 className="text-2xl font-black text-slate-800 mb-2">作業日報システム</h1>
                        <p className="text-sm font-bold text-slate-500 mb-8">自分の名前を選んでください</p>

                        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto px-1 pb-4">
                            {workers.map(w => (
                                <button
                                    key={w.id}
                                    onClick={() => handleLogin(w)}
                                    className="w-full bg-slate-50 border-2 border-slate-200 p-4 rounded-xl text-lg font-bold text-slate-700 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 transition active:scale-[0.98]"
                                >
                                    {w.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ========== メイン画面（日報入力） ==========
    const activeProject = projects.find(p => p.id === Number(selectedProjectId));
    const isForeman = activeProject && activeProject.foreman_worker_id === loggedInWorker.id;

    // 現在の入力合計時間を計算
    const totalInputHours = tasks.reduce((sum, t) => {
        return sum + (Number(t.today_hours) || 0) + (Number(t.today_overtime_hours) || 0);
    }, 0);

    // 職長用ダッシュボードの計算
    let foremanSummary = null;
    if (isForeman) {
        const totalTarget = tasks.reduce((sum, t) => sum + (Number(t.target_hours) || 0), 0);

        let totalActual = 0;
        let predictedProfitLoss = 0;

        tasks.forEach(t => {
            const actual = allProjectRecords.filter(r => r.project_task_id === t.id).reduce((sum, r) => sum + Number(r.hours), 0);
            totalActual += actual;

            const progress = t.progress_percentage || 0;
            const predictedFinal = progress > 0 ? (actual / (progress / 100)) : 0;
            const taskProfitLoss = progress > 0 ? (t.target_hours - predictedFinal) * hourlyWage : 0;
            predictedProfitLoss += taskProfitLoss;
        });

        const subcontractorCost = allSubcontractorRecords.reduce((sum, s) => sum + (Number(s.worker_count) * Number(s.unit_price || 25000)), 0);

        const overallProgress = totalTarget > 0
            ? tasks.reduce((sum, t) => sum + (t.target_hours * (t.progress_percentage || 0)), 0) / totalTarget
            : 0;

        foremanSummary = {
            totalTarget,
            totalActual,
            overallProgress: Math.round(overallProgress),
            predictedProfitLoss: Math.round(predictedProfitLoss - subcontractorCost),
        };
    }

    return (
        <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-24">
            <header className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <HardHat size={20} />
                    <span className="font-bold text-lg leading-none">{loggedInWorker.name} </span>
                </div>
                <button
                    onClick={handleLogout}
                    className="flex items-center gap-1 bg-blue-700 hover:bg-blue-800 px-3 py-1.5 rounded-lg text-sm font-bold transition"
                >
                    <LogOut size={16} /> 終了
                </button>
            </header>

            <main className="p-4 max-w-lg mx-auto">
                <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-600 mb-2">今日の現場を選択</label>
                    <select
                        value={selectedProjectId}
                        onChange={(e) => {
                            setSelectedProjectId(e.target.value);
                            localStorage.setItem('cost-app-worker-project', e.target.value);
                        }}
                        className="w-full bg-white border-2 border-blue-200 text-slate-800 p-4 rounded-xl font-bold text-lg outline-none focus:border-blue-500 shadow-sm appearance-none"
                    >
                        <option value="">現場を選ぶ...</option>
                        {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name || '無題の現場'}</option>
                        ))}
                    </select>
                </div>

                {isLoading && selectedProjectId && (
                    <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>
                )}

                {!isLoading && selectedProjectId && tasks.length === 0 && (
                    <div className="text-center p-10 bg-white rounded-xl border-dashed border-2 border-slate-300">
                        <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-500 font-bold">この現場には作業項目がありません。</p>
                    </div>
                )}

                {!isLoading && selectedProjectId && tasks.length > 0 && (
                    <div className="flex flex-col gap-4">
                        {isForeman && foremanSummary && (
                            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-2">
                                <div className="bg-green-600 px-4 py-3 flex gap-2 items-center text-white shadow-sm">
                                    <CheckCircle2 className="shrink-0 w-5 h-5" />
                                    <h3 className="font-bold text-sm">職長ダッシュボード</h3>
                                </div>
                                <div className="bg-green-50 px-4 py-2 border-b border-green-100 text-xs font-bold text-green-800 flex items-start gap-1">
                                    <span className="text-green-600 mt-0.5">※</span>
                                    <span>あなたは職長です。本日の作業終了後、各作業項目の<strong className="text-green-700 underline underline-offset-2 mx-1">進捗率</strong>を更新してください。</span>
                                </div>
                                <div className="p-4 bg-slate-50 flex flex-col gap-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
                                            <div className="text-[10px] font-bold text-slate-500 mb-1">全体進捗率</div>
                                            <div className="text-2xl font-black text-blue-600">{foremanSummary.overallProgress}%</div>
                                        </div>
                                        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
                                            <div className="text-[10px] font-bold text-slate-500 mb-1">消化工数 / 全体目標</div>
                                            <div className="text-lg font-black text-slate-700">
                                                {foremanSummary.totalActual.toFixed(1)} <span className="text-xs text-slate-400 font-bold mx-0.5">/</span> {foremanSummary.totalTarget.toFixed(1)} <span className="text-xs text-slate-400">h</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
                                        <div className="text-[10px] font-bold text-slate-500 mb-1">現場全体の予測粗利</div>
                                        <div className={`text-2xl font-black ${foremanSummary.predictedProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            ¥{Math.abs(foremanSummary.predictedProfitLoss).toLocaleString()}
                                            <span className="text-sm ml-1">{foremanSummary.predictedProfitLoss >= 0 ? '' : '赤字'}</span>
                                        </div>
                                        <div className={`text-[10px] font-bold mt-1 ${foremanSummary.predictedProfitLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                            {foremanSummary.predictedProfitLoss >= 0 ? '現在のペースなら目標達成可能！' : 'このままだとマイナスだ。至急対策を！'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {tasks.map(t => (
                            <div key={t.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 p-4 border-b border-slate-100">
                                    <h3 className="font-bold text-slate-800 leading-snug">{t.name}</h3>
                                </div>
                                <div className="p-4 flex flex-col gap-4">
                                    {/* 作業時間の入力群 */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 mb-2">今日作業した時間</label>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => adjustHours(t.id, -0.5)}
                                                className="w-14 h-14 rounded-xl bg-slate-100 text-slate-600 font-black text-2xl active:bg-slate-200 transition shrink-0 flex items-center justify-center disabled:opacity-50"
                                                disabled={t.today_hours <= 0}
                                            >-</button>
                                            <input
                                                type="number"
                                                step="0.5"
                                                min="0"
                                                value={t.today_hours || 0}
                                                onChange={(e) => updateTaskField(t.id, 'today_hours', Math.max(0, Number(e.target.value)))}
                                                className="flex-1 w-full min-w-0 h-14 text-center text-3xl font-black text-blue-600 bg-blue-50 border-2 border-blue-100 rounded-xl outline-none focus:border-blue-400"
                                            />
                                            <button
                                                onClick={() => adjustHours(t.id, 0.5)}
                                                className="w-14 h-14 rounded-xl bg-blue-100 text-blue-600 font-black text-2xl active:bg-blue-200 transition shrink-0 flex items-center justify-center"
                                            >+</button>
                                        </div>
                                    </div>

                                    {/* 時間外（早出・残業）入力 */}
                                    <div>
                                        <div className="flex items-center justify-between">
                                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-tight">うち時間外稼働 (早出・残業)</label>
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number"
                                                    step="0.5"
                                                    min="0"
                                                    value={t.today_overtime_hours || 0}
                                                    onChange={(e) => updateTaskField(t.id, 'today_overtime_hours', Math.max(0, Number(e.target.value)))}
                                                    className="w-20 h-10 text-center text-xl font-black text-orange-600 bg-orange-50 border-2 border-orange-200 rounded-lg outline-none focus:border-orange-500 transition"
                                                    placeholder="0"
                                                />
                                                <span className="text-slate-400 font-bold text-sm">h</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* メモ */}
                                    {t.today_hours > 0 && (
                                        <input
                                            type="text"
                                            placeholder="メモ（任意）"
                                            value={t.today_note || ''}
                                            onChange={(e) => updateTaskField(t.id, 'today_note', e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 p-3 rounded-lg text-sm outline-none focus:border-blue-400"
                                        />
                                    )}

                                    {/* 職長のみの進捗率スライダー */}
                                    {isForeman && (
                                        <div className="mt-2 pt-4 border-t border-slate-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <label className="text-xs font-bold text-green-700">現在の進捗率</label>
                                                <span className="font-black text-green-700">{t.progress_percentage}%</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0" max="100" step="5"
                                                value={t.progress_percentage || 0}
                                                onChange={(e) => updateTaskField(t.id, 'progress_percentage', Number(e.target.value))}
                                                className="w-full h-3 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* 新規作業項目追加ボタン */}
                        <button
                            onClick={handleAddNewTask}
                            className="bg-white border-2 border-dashed border-slate-300 text-slate-500 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition"
                        >
                            <PlusCircle size={20} />
                            新しい作業項目を追加
                        </button>

                        {/* 協力業者の入力セクション (職長のみ) */}
                        {isForeman && (
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-2 mb-20">
                                <div className="bg-blue-50 p-4 border-b border-blue-100 flex justify-between items-center">
                                    <h3 className="font-bold text-blue-800 leading-snug">協力業者 (常用)</h3>
                                    <button
                                        onClick={addSubcontractor}
                                        className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-bold shadow-sm hover:bg-blue-700 transition"
                                    >
                                        + 追加
                                    </button>
                                </div>
                                <div className="p-4 flex flex-col gap-3">
                                    {subcontractors.length === 0 ? (
                                        <div className="text-center py-4 text-slate-400 text-sm font-bold border-2 border-dashed border-slate-100 rounded-xl">追加ボタンから業者を入力してください</div>
                                    ) : (
                                        subcontractors.map(s => (
                                            <div key={s.id} className="flex gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                                                <input
                                                    type="text"
                                                    placeholder="会社名"
                                                    value={s.company_name || ''}
                                                    onChange={(e) => updateSubcontractor(s.id, 'company_name', e.target.value)}
                                                    className="flex-1 min-w-0 bg-white border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none focus:border-blue-400"
                                                />
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <input
                                                        type="number"
                                                        min="0.1"
                                                        step="0.1"
                                                        value={s.worker_count || ''}
                                                        onChange={(e) => updateSubcontractor(s.id, 'worker_count', Number(e.target.value))}
                                                        className="w-16 bg-white border border-slate-200 p-2 rounded-lg text-sm text-center font-bold outline-none focus:border-blue-400"
                                                    />
                                                    <span className="text-xs font-bold text-slate-500">人</span>
                                                </div>
                                                <button
                                                    onClick={() => removeSubcontractor(s.id)}
                                                    className="w-8 h-8 flex items-center justify-center shrink-0 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* 送信フローティングボタン */}
            {selectedProjectId && tasks.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-100 via-slate-100/90 to-transparent pointer-events-none z-40">
                    <div className="max-w-lg mx-auto flex flex-col gap-2 pointer-events-auto">
                        {saveMessage && (
                            <div className="bg-green-600 text-white text-sm font-bold p-3 rounded-xl text-center shadow-lg animate-in fade-in slide-in-from-bottom-4">
                                {saveMessage}
                            </div>
                        )}
                        <button
                            onClick={handleSubmit}
                            disabled={isSaving}
                            className="w-full bg-blue-600 text-white py-4 rounded-xl shadow-xl shadow-blue-600/20 active:bg-blue-700 transition flex flex-col justify-center items-center gap-1 disabled:opacity-70"
                        >
                            <div className="flex items-center gap-2 font-black text-lg">
                                {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                                今日の実績を送信
                            </div>
                            <div className="text-blue-200 text-sm font-bold flex items-center gap-1">
                                合計入力時間: <span className="text-white text-xl">{totalInputHours.toFixed(1)}</span> h
                            </div>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkerApp;
