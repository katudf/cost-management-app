import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Layout, Table, Clipboard, AlertCircle, Plus, Trash2, CheckCircle2, BarChart3, Settings, Edit3, Home, TrendingDown, TrendingUp, DollarSign, FolderGit2, PlusCircle, Trash, Upload, Loader2 } from 'lucide-react';
import * as xlsx from 'xlsx';
import { supabase } from './lib/supabase';

// 初期データのひな形 (DBが空の時のため)
const DEFAULT_MASTER_DATA = [
    { id: 'temp-1', task: '屋根：高圧洗浄・プライマー', target: 14 },
    { id: 'temp-2', task: '屋根：ウレタン防水', target: 73 },
];

const App = () => {
    const [activeTab, setActiveTab] = useState('summary');
    const [importModalInfo, setImportModalInfo] = useState(null);
    const [aliasName, setAliasName] = useState("");
    const [workers, setWorkers] = useState([]);
    const [focusedWorkerRow, setFocusedWorkerRow] = useState(null);

    // DB連携ステート
    const [projects, setProjects] = useState([]);
    const [activeProjectId, setActiveProjectId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // 単価設定 (35,000円 / 8h = 4,375円)
    const HOURLY_WAGE = 4375;

    // -- 起動時のデータ取得 --
    const fetchAllData = async (forceActiveId = null) => {
        if (!supabase) return;
        setIsLoading(true);
        try {
            // Workers取得
            const { data: wData } = await supabase.from('Workers').select('id, name').order('display_order', { ascending: true, nullsFirst: false });
            if (wData) setWorkers(wData.filter(w => w.name && w.name.trim() !== ''));

            // Projects, ProjectTasks, TaskRecords取得
            const { data: pData, error: pError } = await supabase.from('Projects').select('*').order('created_at', { ascending: true });
            if (pError) throw pError;

            const { data: tData, error: tError } = await supabase.from('ProjectTasks').select('*').order('order', { ascending: true });
            if (tError) throw tError;

            const { data: rData, error: rError } = await supabase.from('TaskRecords').select('*').order('date', { ascending: false });
            if (rError) throw rError;

            // ローカルステート用の構造にマッピング
            const loadedProjects = pData.map(p => {
                const myTasks = tData.filter(t => t.projectId === p.id);
                const myRecords = rData.filter(r => r.project_id === p.id);

                const masterData = myTasks.map(t => ({
                    id: t.id,
                    task: t.name || '',
                    target: t.target_hours || 0
                }));

                const progressData = {};
                myTasks.forEach(t => {
                    progressData[t.id] = t.progress_percentage || 0;
                });

                const records = myRecords.map(r => ({
                    id: r.id,
                    date: r.date,
                    taskId: r.project_task_id,
                    worker: r.worker_name || '',
                    hours: r.hours || 0,
                    note: r.note || ''
                }));

                return {
                    id: p.id,
                    siteName: p.name || '無題',
                    masterData,
                    records,
                    progressData
                };
            });

            setProjects(loadedProjects);

            // ActiveProjectの復元
            if (loadedProjects.length > 0) {
                if (forceActiveId && loadedProjects.some(lp => lp.id === forceActiveId)) {
                    setActiveProjectId(forceActiveId);
                } else {
                    const savedId = localStorage.getItem('cost-app-activeProjectId');
                    if (savedId && loadedProjects.some(lp => lp.id === Number(JSON.parse(savedId)))) {
                        setActiveProjectId(Number(JSON.parse(savedId)));
                    } else {
                        setActiveProjectId(loadedProjects[0].id);
                    }
                }
            } else {
                setActiveProjectId(null);
            }
        } catch (error) {
            console.error('データ取得エラー:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAllData();
    }, []);

    useEffect(() => {
        if (activeProjectId) {
            localStorage.setItem('cost-app-activeProjectId', JSON.stringify(activeProjectId));
        }
    }, [activeProjectId]);

    // -- プロジェクト・ヘルパー --
    const activeProject = projects.find(p => p.id === activeProjectId) || projects[0] || {
        id: 'loading', siteName: '読込中...', masterData: [], records: [], progressData: {}
    };

    const updateLayer = (updater) => {
        setProjects(prev => prev.map(p =>
            p.id === activeProjectId ? { ...p, ...updater(p) } : p
        ));
    };

    // --- DB連動アクション ---

    const addNewProject = async () => {
        const { data, error } = await supabase.from('Projects').insert([{ name: '新規の現場', order: projects.length }]).select();
        if (error) {
            console.error(error);
            alert('現場の作成に失敗しました: ' + error.message);
            return;
        }
        const newProj = data[0];

        setProjects(prev => [...prev, {
            id: newProj.id, siteName: newProj.name, masterData: [], records: [], progressData: {}
        }]);
        setActiveProjectId(newProj.id);
    };

    const removeProject = async (id) => {
        if (projects.length <= 1) {
            alert("最後の現場は削除できません！");
            return;
        }
        if (confirm("本当にこの現場のデータをすべて削除しますか？")) {
            // DB削除
            const { error } = await supabase.from('Projects').delete().eq('id', id);
            if (error) { console.error(error); alert("削除失敗"); return; }

            setProjects(prev => prev.filter(p => p.id !== id));
            if (activeProjectId === id) {
                setActiveProjectId(projects.find(p => p.id !== id).id);
            }
        }
    };

    const handleSiteNameBlur = async (id, newName) => {
        await supabase.from('Projects').update({ name: newName }).eq('id', id);
    };

    const updateMasterItemLocal = (id, field, value) => {
        updateLayer(p => ({
            masterData: p.masterData.map(m => m.id === id ? { ...m, [field]: value } : m)
        }));
    };

    const saveMasterItemDB = async (dbItemId, updateData) => {
        if (String(dbItemId).startsWith('temp-')) return;
        await supabase.from('ProjectTasks').update(updateData).eq('id', dbItemId);
    };

    const saveProgressDB = async (dbItemId, value) => {
        if (String(dbItemId).startsWith('temp-')) return;
        await supabase.from('ProjectTasks').update({ progress_percentage: value }).eq('id', dbItemId);
    };

    const addRecord = async () => {
        const defaultTaskId = activeProject.masterData[0]?.id;
        if (!defaultTaskId) {
            alert("先に工事設定で作業項目を登録してください");
            return;
        }

        const newDbRecord = {
            project_id: activeProjectId,
            project_task_id: defaultTaskId,
            date: new Date().toISOString().split('T')[0],
            hours: 0,
            worker_name: '',
            note: ''
        };

        const { data, error } = await supabase.from('TaskRecords').insert([newDbRecord]).select();
        if (error) { console.error(error); return; }

        const dbRec = data[0];
        const newLocalRecord = {
            id: dbRec.id,
            date: dbRec.date,
            taskId: dbRec.project_task_id,
            worker: dbRec.worker_name || '',
            hours: dbRec.hours || 0,
            note: dbRec.note || ''
        };

        updateLayer(p => ({ records: [newLocalRecord, ...p.records] }));
    };

    const removeRecord = async (recordId) => {
        const { error } = await supabase.from('TaskRecords').delete().eq('id', recordId);
        if (error) { console.error(error); return; }
        updateLayer(p => ({ records: p.records.filter(r => r.id !== recordId) }));
    };

    const updateRecordField = async (recordId, field, value) => {
        // UI即時反映
        updateLayer(p => ({
            records: p.records.map(r => r.id === recordId ? { ...r, [field]: value } : r)
        }));

        // DB更新
        const dbFieldMap = { date: 'date', taskId: 'project_task_id', worker: 'worker_name', hours: 'hours', note: 'note' };
        if (dbFieldMap[field]) {
            await supabase.from('TaskRecords').update({ [dbFieldMap[field]]: value }).eq('id', recordId);
        }
    };

    // --- Excelインポート ---
    const fileInputRef = useRef(null);

    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = event.target.result;
                const workbook = xlsx.read(data, { type: 'binary' });

                let newMasterData = [];
                let extractedProjectName = null;

                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

                    rows.forEach(row => {
                        if (!extractedProjectName) {
                            for (let i = 0; i < row.length; i++) {
                                const cell = row[i];
                                if (typeof cell === 'string' && cell.replace(/\s+/g, '') === '工事名') {
                                    for (let j = i + 1; j < row.length; j++) {
                                        if (row[j] && typeof row[j] === 'string' && row[j].trim() !== '') {
                                            extractedProjectName = row[j].trim();
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                        }

                        const name = row[2];      // C列
                        const spec = row[24];     // Y列
                        const quantity = row[40]; // AO列
                        const unit = row[43];     // AR列
                        const amount = row[49];   // AX列

                        if (
                            name && typeof name === 'string' &&
                            !name.includes('合　計') && !name.includes('小　計') &&
                            !name.includes('諸経費') && !name.includes('値引') &&
                            typeof quantity === 'number'
                        ) {
                            const taskName = `${name}${spec ? ` [${spec}]` : ''} (${quantity}${unit || ''})`;
                            let targetHours = 0;
                            if (typeof amount === 'number' && amount > 0) {
                                targetHours = Math.round(amount / HOURLY_WAGE);
                            }

                            newMasterData.push({ task: taskName, target: targetHours }); // DB用なのでID持たせず
                        }
                    });
                });

                if (newMasterData.length > 0) {
                    const finalSiteName = extractedProjectName || file.name.replace(/\.[^/.]+$/, "");
                    const duplicateProject = projects.find(p => p.siteName === finalSiteName);

                    if (duplicateProject) {
                        setImportModalInfo({ type: 'duplicate', data: newMasterData, count: newMasterData.length, fileName: finalSiteName, duplicateId: duplicateProject.id });
                        setAliasName(`${finalSiteName} (コピー)`);
                    } else if (activeProject.masterData && activeProject.masterData.length > 0) {
                        setImportModalInfo({ type: 'normal', data: newMasterData, count: newMasterData.length, fileName: finalSiteName });
                    } else {
                        // 空の場合はそのまま上書き
                        handleImportChoice('overwrite_empty', { finalSiteName, data: newMasterData, projId: activeProjectId });
                    }
                } else {
                    alert('取り込めるデータが見つかりませんでした。');
                }
            } catch (error) {
                console.error('Excelパースエラー:', error);
                alert('エラーが発生しました。');
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };
        reader.readAsBinaryString(file);
    };

    const handleImportChoice = async (choice, directParams = null) => {
        const info = directParams || importModalInfo;
        if (!info) return;
        setIsLoading(true);

        try {
            let targetProjectId = null;
            let siteNameToUse = info.fileName || info.finalSiteName || 'エクセル取込現場';

            if (choice === 'create_new') {
                const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: projects.length }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'create_alias') {
                const { data, error } = await supabase.from('Projects').insert([{ name: aliasName || 'エクセル取込現場', order: projects.length }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'overwrite' || choice === 'overwrite_empty') {
                targetProjectId = directParams ? directParams.projId : activeProjectId;
                if (!targetProjectId) {
                    const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: projects.length }]).select();
                    if (error) throw error;
                    targetProjectId = data[0].id;
                } else {
                    await supabase.from('ProjectTasks').delete().eq('projectId', targetProjectId);
                    if (choice === 'overwrite_empty' || siteNameToUse !== "エクセル取込現場") {
                        await supabase.from('Projects').update({ name: siteNameToUse }).eq('id', targetProjectId);
                    }
                }
            } else if (choice === 'overwrite_duplicate') {
                targetProjectId = info.duplicateId;
                await supabase.from('ProjectTasks').delete().eq('projectId', targetProjectId);
            }

            // タスクの挿入
            const tasksToInsert = info.data.map((m, idx) => ({
                projectId: targetProjectId,
                name: m.task,
                target_hours: m.target,
                order: idx + 1,
                progress_percentage: 0
            }));

            await supabase.from('ProjectTasks').insert(tasksToInsert);

            // DBから最新を再フェッチ
            await fetchAllData(targetProjectId);

        } catch (e) {
            console.error(e);
            alert("DB保存中にエラーが発生しました");
        } finally {
            setIsLoading(false);
            setImportModalInfo(null);
            setAliasName("");
        }
    };


    // 個別・全体集計ロジック
    const summaryData = useMemo(() => {
        if (!activeProject || !activeProject.masterData) return { items: [], totalActual: 0, totalTarget: 0, totalPredictedProfitLoss: 0 };
        const items = activeProject.masterData.map(m => {
            const actual = activeProject.records.filter(r => r.taskId === m.id).reduce((sum, r) => sum + Number(r.hours), 0);
            const progress = activeProject.progressData[m.id] || 0;
            const consumptionRate = m.target > 0 ? (actual / m.target) * 100 : 0;
            const variance = progress - consumptionRate;

            const predictedFinal = progress > 0 ? (actual / (progress / 100)) : 0;
            const predictedProfitLoss = progress > 0 ? (m.target - predictedFinal) * HOURLY_WAGE : 0;

            return { ...m, actual, progress, variance, predictedProfitLoss, status: variance < -5 ? 'danger' : variance < 0 ? 'warning' : 'ok' };
        });

        const totalActual = items.reduce((sum, i) => sum + i.actual, 0);
        const totalTarget = items.reduce((sum, i) => sum + i.target, 0);
        const totalPredictedProfitLoss = items.reduce((sum, i) => sum + i.predictedProfitLoss, 0);

        return { items, totalActual, totalTarget, totalPredictedProfitLoss };
    }, [activeProject.masterData, activeProject.records, activeProject.progressData]);

    if (isLoading && projects.length === 0) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
            <div className="max-w-6xl mx-auto">
                <header className="mb-6">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="flex-1">
                            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-3">
                                <BarChart3 className="text-blue-600" /> 詳細工数管理システム
                            </h1>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative flex items-center">
                                    <FolderGit2 className="absolute left-3 text-slate-400 w-4 h-4" />
                                    <select
                                        value={activeProjectId || ''}
                                        onChange={(e) => setActiveProjectId(Number(e.target.value))}
                                        className="pl-9 pr-8 py-2 bg-white border border-slate-300 rounded-lg shadow-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 appearance-none hover:border-slate-400 transition"
                                    >
                                        {projects.length === 0 && <option value="">現場なし</option>}
                                        {projects.map(p => (
                                            <option key={p.id} value={p.id}>{p.siteName || '無題の現場'}</option>
                                        ))}
                                    </select>
                                </div>
                                {activeTab === 'master' && (
                                    <button onClick={addNewProject} title="新しい現場を追加" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition shadow-sm border border-transparent hover:border-blue-200">
                                        <PlusCircle size={20} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <nav className="bg-white p-2 rounded-lg shadow-sm border flex gap-1 mt-2 md:mt-0">
                            {['summary', 'input', 'master'].map((tab) => (
                                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-md transition font-bold ${activeTab === tab ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
                                    {tab === 'summary' ? '管理シート' : tab === 'input' ? '実績入力' : '工事設定'}
                                </button>
                            ))}
                        </nav>
                    </div>
                </header>

                <main className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden min-h-[500px]">
                    {isLoading && <div className="h-1 bg-blue-100 overflow-hidden"><div className="w-1/2 h-full bg-blue-500 animate-pulse"></div></div>}

                    {activeTab === 'summary' && (
                        <div className={`p-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            {/* 全体の予測損益サマリーを表示 */}
                            <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className={`p-6 rounded-2xl border-2 flex flex-col justify-center transition-all shadow-lg ${summaryData.totalPredictedProfitLoss >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200 animate-pulse'}`}>
                                    <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">現場全体の予測粗利</div>
                                    <div className={`text-3xl font-black flex items-center gap-2 ${summaryData.totalPredictedProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {summaryData.totalPredictedProfitLoss >= 0 ? <TrendingUp size={32} /> : <TrendingDown size={32} />}
                                        ¥{Math.abs(Math.round(summaryData.totalPredictedProfitLoss)).toLocaleString()}
                                    </div>
                                    <div className={`text-[10px] font-bold mt-1 ${summaryData.totalPredictedProfitLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                        {summaryData.totalPredictedProfitLoss >= 0 ? '現在の進捗ペースなら目標粗利を確保可能だ！会社経費もカバーできるぞ！' : 'このままだと現場粗利がマイナスだ。至急対策を！'}
                                    </div>
                                </div>

                                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 flex flex-col justify-center">
                                    <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">消化済工数 / 全体目標</div>
                                    <div className="text-2xl font-black text-slate-800 flex items-baseline gap-2">
                                        {summaryData.totalActual}<span className="text-sm font-normal text-slate-500">h</span>
                                        <span className="text-slate-300 font-light mx-1">/</span>
                                        {summaryData.totalTarget}<span className="text-sm font-normal text-slate-500">h</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mb-4 border-b pb-4">
                                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800"><Layout className="text-blue-500 w-5 h-5" /> 項目別詳細予測</h2>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b text-slate-600 text-sm">
                                            <th className="p-4 font-bold">作業項目</th>
                                            <th className="p-4 font-bold">目標/実績</th>
                                            <th className="p-4 font-bold w-40">進捗</th>
                                            <th className="p-4 font-bold text-center">工数差異</th>
                                            <th className="p-4 font-bold text-right">項目別予測粗利</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {summaryData.items.map(item => (
                                            <tr key={item.id} className={`border-b transition ${item.status === 'danger' ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                                                <td className="p-4">
                                                    <div className="font-bold text-sm">{item.task}</div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="text-[10px] text-slate-500 tracking-tighter">目標: {item.target}h</div>
                                                    <div className="font-mono font-bold text-slate-700">{item.actual}h <span className="text-[10px] font-normal">消化</span></div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="range" min="0" max="100" step="5"
                                                            value={item.progress}
                                                            onChange={(e) => {
                                                                const val = Number(e.target.value);
                                                                updateLayer(p => ({ progressData: { ...p.progressData, [item.id]: val } }));
                                                            }}
                                                            onMouseUp={(e) => saveProgressDB(item.id, Number(e.target.value))}
                                                            onTouchEnd={(e) => saveProgressDB(item.id, Number(e.target.value))}
                                                            className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                                        />
                                                        <span className="text-xs font-black text-blue-700 w-8">{item.progress}%</span>
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <div className={`text-lg font-black ${item.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                        {item.variance > 0 ? '+' : ''}{item.variance.toFixed(1)}%
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <div className={`flex items-center justify-end gap-1 font-black ${item.predictedProfitLoss < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                        {item.progress > 0 ? `¥${Math.abs(Math.round(item.predictedProfitLoss)).toLocaleString()}` : '-'}
                                                    </div>
                                                    <div className="text-[9px] text-slate-400 font-bold">{item.predictedProfitLoss < 0 ? '損失予知' : '利益見込'}</div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'input' && (
                        <div className={`p-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-lg font-bold flex items-center gap-2 text-blue-600"><Edit3 size={20} /> 日報実績入力</h2>
                                <button onClick={addRecord} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-blue-700 shadow-md"><Plus size={16} /> 日報1件追加</button>
                            </div>
                            <div className="overflow-x-auto pb-32">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 border-b text-slate-500 font-bold">
                                        <tr><th className="p-3 w-32">日付</th><th className="p-3">作業</th><th className="p-3 w-24">名前</th><th className="p-3 w-20">時間</th><th className="p-3">備考</th><th className="p-3"></th></tr>
                                    </thead>
                                    <tbody>
                                        {activeProject.records.map((r, i) => (
                                            <tr key={r.id} className="border-b hover:bg-slate-50">
                                                <td className="p-2">
                                                    <input
                                                        type="date"
                                                        value={r.date}
                                                        className="border rounded p-1 w-full text-xs"
                                                        onChange={(e) => updateRecordField(r.id, 'date', e.target.value)}
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <select
                                                        value={r.taskId}
                                                        className="border rounded p-1 w-full font-bold text-xs"
                                                        onChange={(e) => updateRecordField(r.id, 'taskId', Number(e.target.value))}
                                                    >
                                                        {activeProject.masterData.map(m => <option key={m.id} value={m.id}>{m.task}</option>)}
                                                    </select>
                                                </td>
                                                <td className="p-2 relative">
                                                    <input
                                                        type="text"
                                                        value={r.worker || ""}
                                                        placeholder="氏名を入力・選択"
                                                        className="border rounded p-1 w-full text-xs outline-none focus:border-blue-400 focus:bg-blue-50 transition"
                                                        onFocus={(e) => {
                                                            e.target.select();
                                                            setFocusedWorkerRow(r.id);
                                                        }}
                                                        onBlur={() => setTimeout(() => setFocusedWorkerRow(null), 200)}
                                                        onChange={(e) => updateRecordField(r.id, 'worker', e.target.value)}
                                                    />
                                                    {focusedWorkerRow === r.id && workers.length > 0 && (
                                                        <ul className="absolute z-[100] left-2 right-2 top-[calc(100%-4px)] mt-1 bg-white border border-slate-200 shadow-2xl max-h-48 overflow-y-auto rounded-md py-1">
                                                            {workers.map(w => (
                                                                <li
                                                                    key={w.id}
                                                                    className="px-3 py-2 text-xs hover:bg-blue-100 cursor-pointer text-slate-800 font-medium"
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        updateRecordField(r.id, 'worker', w.name);
                                                                        setFocusedWorkerRow(null);
                                                                    }}
                                                                >
                                                                    {w.name}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                                <td className="p-2">
                                                    <input
                                                        type="number"
                                                        value={r.hours}
                                                        className="border rounded p-1 w-full text-right font-bold text-xs"
                                                        onChange={(e) => updateRecordField(r.id, 'hours', Number(e.target.value))}
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <input
                                                        type="text"
                                                        value={r.note || ""}
                                                        placeholder="内容"
                                                        className="border rounded p-1 w-full text-xs"
                                                        onChange={(e) => updateRecordField(r.id, 'note', e.target.value)}
                                                    />
                                                </td>
                                                <td className="p-2 text-center"><button onClick={() => removeRecord(r.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'master' && (
                        <div className={`p-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-700"><Settings size={20} /> 見積仕様・目標工数設定</h2>
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        type="file"
                                        accept=".xlsx, .xls"
                                        onChange={handleExcelImport}
                                        ref={fileInputRef}
                                        className="hidden"
                                        id="excel-upload"
                                    />
                                    <label
                                        htmlFor="excel-upload"
                                        className="cursor-pointer text-blue-600 bg-blue-50 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-blue-100 transition border border-blue-200"
                                    >
                                        {isLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <Upload size={16} />} Excelからインポート
                                    </label>
                                    <button onClick={() => removeProject(activeProjectId)} className="text-red-500 bg-red-50 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-red-100 transition border border-red-200">
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
                                    className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-xl outline-none focus:border-blue-500"
                                />
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
                                            <div className="w-24 text-right">
                                                <label className="text-[9px] font-bold text-slate-400 block mb-1 uppercase text-right tracking-tighter">目標時間</label>
                                                <div className="flex items-center gap-1 justify-end font-mono font-bold">
                                                    <input
                                                        type="number" value={m.target}
                                                        className="w-full text-right outline-none bg-slate-50 rounded px-1"
                                                        onChange={(e) => updateMasterItemLocal(m.id, 'target', Number(e.target.value))}
                                                        onBlur={() => saveMasterItemDB(m.id, { target_hours: m.target })}
                                                    /><span>h</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </main>

                {/* エクセルインポート時の選択モーダル */}
                {importModalInfo && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full">
                            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <AlertCircle className="text-blue-500" />
                                インポート方法の選択
                            </h3>
                            <p className="text-slate-600 mb-6">
                                Excelファイルから <span className="font-bold text-blue-600 text-lg">{importModalInfo.count}件</span> の作業項目データを読み込みました。<br />
                                {importModalInfo.type === 'duplicate' ? (
                                    <span className="text-red-500 font-bold mt-2 inline-block">「{importModalInfo.fileName}」は既に登録されています。</span>
                                ) : (
                                    "既存のデータが存在するため、処理方法を選択してください。"
                                )}
                            </p>

                            <div className="flex flex-col gap-3">
                                {importModalInfo.type === 'duplicate' ? (
                                    <>
                                        <button
                                            onClick={() => handleImportChoice('overwrite_duplicate')}
                                            className="p-4 border-2 border-red-300 rounded-lg hover:bg-red-50 transition text-left group disabled:opacity-50"
                                            disabled={isLoading}
                                        >
                                            <div className="font-bold text-red-700 text-lg mb-1 group-hover:underline flex items-center gap-2">
                                                <Edit3 size={20} /> 既存の現場に上書き
                                            </div>
                                            <div className="text-sm text-slate-500">
                                                既に登録されている「{importModalInfo.fileName}」を今回のデータで上書きします。
                                            </div>
                                        </button>
                                        <div className="p-4 border-2 border-blue-500 rounded-lg bg-blue-50 text-left flex flex-col gap-2">
                                            <div className="font-bold text-blue-700 text-lg flex items-center gap-2">
                                                <PlusCircle size={20} /> 別名で新規登録
                                            </div>
                                            <div className="text-sm text-slate-600 mb-1">
                                                重複を避けるため、別の名前で新しい現場として登録します。
                                            </div>
                                            <input
                                                type="text"
                                                value={aliasName}
                                                onChange={(e) => setAliasName(e.target.value)}
                                                className="w-full p-2 border border-blue-300 rounded font-bold"
                                            />
                                            <button
                                                onClick={() => handleImportChoice('create_alias')}
                                                disabled={!aliasName.trim() || isLoading}
                                                className="w-full bg-blue-600 text-white font-bold py-2 mt-1 rounded hover:bg-blue-700 transition disabled:opacity-50"
                                            >
                                                {isLoading ? '保存中...' : 'この名前で登録する'}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => handleImportChoice('create_new')}
                                            className="p-4 border-2 border-blue-500 rounded-lg hover:bg-blue-50 transition text-left group disabled:opacity-50"
                                            disabled={isLoading}
                                        >
                                            <div className="font-bold text-blue-700 text-lg mb-1 group-hover:underline flex items-center gap-2">
                                                <PlusCircle size={20} /> 新規作成 (新しい現場として作成)
                                            </div>
                                            <div className="text-sm text-slate-500">
                                                新しい現場「{importModalInfo.fileName}」を作成し、そこにデータをインポートします。現在の現場データは一切変更されません。
                                            </div>
                                        </button>

                                        <button
                                            onClick={() => handleImportChoice('overwrite')}
                                            className="p-4 border-2 border-slate-300 rounded-lg hover:bg-slate-50 transition text-left group disabled:opacity-50"
                                            disabled={isLoading}
                                        >
                                            <div className="font-bold text-slate-700 text-lg mb-1 group-hover:underline flex items-center gap-2">
                                                <Edit3 size={20} /> 現在の現場を上書き
                                            </div>
                                            <div className="text-sm text-slate-500">
                                                現在表示している現場の「工事設定（作業項目）」をこのExcelデータで置き換えます。
                                            </div>
                                        </button>
                                    </>
                                )}

                                <button
                                    onClick={() => {
                                        setImportModalInfo(null);
                                        setAliasName("");
                                    }}
                                    disabled={isLoading}
                                    className="mt-2 p-3 text-slate-500 font-bold hover:bg-slate-100 rounded-lg transition text-center disabled:opacity-50"
                                >
                                    キャンセル
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
