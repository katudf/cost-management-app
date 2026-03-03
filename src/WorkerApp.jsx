import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Loader2, LogOut, HardHat, CheckCircle2, AlertCircle, Save } from 'lucide-react';

const WorkerApp = () => {
    const [workers, setWorkers] = useState([]);
    const [loggedInWorker, setLoggedInWorker] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [projects, setProjects] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [tasks, setTasks] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

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

                // Fetch workers for login screen
                const { data: wData } = await supabase.from('Workers').select('id, name').order('display_order', { ascending: true, nullsFirst: false });
                if (wData) {
                    setWorkers(wData.filter(w => w.name && w.name.trim() !== ''));
                }

                // Fetch active projects
                const { data: pData } = await supabase.from('Projects').select('*').order('created_at', { ascending: true });
                if (pData) {
                    setProjects(pData);
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

                const mappedTasks = (tData || []).map(t => {
                    const todayRecord = (rData || []).find(r => r.project_task_id === t.id);
                    return {
                        id: t.id,
                        name: t.name || '',
                        target_hours: t.target_hours || 0,
                        progress_percentage: t.progress_percentage || 0,

                        today_hours: todayRecord ? todayRecord.hours : 0,
                        today_record_id: todayRecord ? todayRecord.id : null,
                        today_note: todayRecord ? todayRecord.note : ''
                    };
                });

                setTasks(mappedTasks);
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
            localStorage.removeItem('cost-app-worker');
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
                if (t.today_hours > 0 || t.today_record_id) {
                    if (t.today_record_id) {
                        // Update existing
                        await supabase.from('TaskRecords').update({
                            hours: t.today_hours || 0,
                            note: t.today_note || ''
                        }).eq('id', t.today_record_id);
                    } else if (t.today_hours > 0) {
                        // Insert new
                        const { data } = await supabase.from('TaskRecords').insert([{
                            project_id: selectedProjectId,
                            project_task_id: t.id,
                            date: today,
                            hours: t.today_hours,
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

            setSaveMessage('日報を送信しました！お疲れ様です。');
            setTimeout(() => setSaveMessage(''), 5000);
        } catch (error) {
            console.error('Submit error:', error);
            window.alert('保存に失敗しました。電波の良いところで再度お試しください。');
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

    return (
        <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-24">
            <header className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <HardHat size={20} />
                    <span className="font-bold text-lg leading-none">{loggedInWorker.name} さん</span>
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
                        onChange={(e) => setSelectedProjectId(e.target.value)}
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
                        {isForeman && (
                            <div className="bg-green-100 border-2 border-green-500 text-green-800 px-4 py-3 rounded-xl font-bold flex gap-2 items-center text-sm shadow-sm">
                                <CheckCircle2 className="shrink-0" />
                                <div>あなたは職長です。<br />「進捗率」の更新をお願いします。</div>
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
                            className="w-full bg-blue-600 text-white font-black text-lg py-4 rounded-xl shadow-xl shadow-blue-600/20 active:bg-blue-700 transition flex justify-center items-center gap-2 disabled:opacity-70"
                        >
                            {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                            今日の実績を送信
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkerApp;
