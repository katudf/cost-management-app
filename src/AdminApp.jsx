import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Layout, Table, Clipboard, AlertCircle, Plus, Trash2, CheckCircle2, BarChart3, Settings, Edit3, Home, TrendingDown, TrendingUp, DollarSign, FolderGit2, PlusCircle, Trash, Upload, Loader2, User, Users, ArrowUp, ArrowDown, FileText, Calendar } from 'lucide-react';
import * as xlsx from 'xlsx-js-style';
import { supabase } from './lib/supabase';

// 初期データのひな形 (DBが空の時のため)
const DEFAULT_MASTER_DATA = [
    { id: 'temp-1', task: '屋根：高圧洗浄・プライマー', target: 14 },
    { id: 'temp-2', task: '屋根：ウレタン防水', target: 73 },
];

const App = () => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [importModalInfo, setImportModalInfo] = useState(null);
    const [aliasName, setAliasName] = useState("");
    const [workers, setWorkers] = useState([]);
    const [focusedWorkerRow, setFocusedWorkerRow] = useState(null);
    const [exportModalWorker, setExportModalWorker] = useState(null);
    const [exportWeekStart, setExportWeekStart] = useState(() => {
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(today.setDate(diff)).toISOString().split('T')[0];
    });

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

            const { data: sData, error: sError } = await supabase.from('SubcontractorRecords').select('*');
            if (sError) throw sError;

            // ローカルステート用の構造にマッピング
            const loadedProjects = pData.map(p => {
                const myTasks = tData.filter(t => t.projectId === p.id);
                const myRecords = rData.filter(r => r.project_id === p.id);

                const masterData = myTasks.map(t => ({
                    id: t.id,
                    task: t.name || '',
                    target: t.target_hours || 0,
                    estimatedAmount: t.estimated_amount || 0
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
                    overtime_hours: r.overtime_hours || 0,
                    note: r.note || ''
                }));

                const mySubcontractors = (sData || []).filter(s => s.project_id === p.id);

                return {
                    id: p.id,
                    order: p.order,
                    siteName: p.name || '無題',
                    foreman_worker_id: p.foreman_worker_id || null,
                    masterData,
                    records,
                    progressData,
                    subcontractors: mySubcontractors
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
        const nextOrder = projects.length > 0 ? Math.max(...projects.map(p => p.order || 0)) + 1 : 0;
        const { data, error } = await supabase.from('Projects').insert([{ name: '新規の現場', order: nextOrder }]).select();
        if (error) {
            console.error(error);
            alert('現場の作成に失敗しました: ' + error.message);
            return;
        }
        const newProj = data[0];

        setProjects(prev => [...prev, {
            id: newProj.id, order: newProj.order, siteName: newProj.name, masterData: [], records: [], progressData: {}
        }]);
        setActiveProjectId(newProj.id);
    };

    const removeProject = async (id) => {
        if (projects.length <= 1) {
            window.alert("最後の現場は削除できません！");
            return;
        }
        if (window.confirm("本当にこの現場のデータをすべて削除しますか？")) {
            // DB関連データの削除 (外部キー制約エラー回避のため順次削除)
            await supabase.from('SubcontractorRecords').delete().eq('project_id', id);
            await supabase.from('TaskRecords').delete().eq('project_id', id);
            await supabase.from('ProjectTasks').delete().eq('projectId', id);

            // DBから現場を削除
            const { error } = await supabase.from('Projects').delete().eq('id', id);
            if (error) {
                console.error(error);
                window.alert("削除に失敗しました: " + error.message);
                return;
            }

            setProjects(prev => prev.filter(p => p.id !== id));
            if (activeProjectId === id) {
                setActiveProjectId(projects.find(p => p.id !== id).id);
            }
        }
    };

    const handleSiteNameBlur = async (id, newName) => {
        await supabase.from('Projects').update({ name: newName }).eq('id', id);
    };

    const handleForemanChange = async (id, workerIdStr) => {
        const workerId = workerIdStr ? Number(workerIdStr) : null;
        updateLayer(p => ({ foreman_worker_id: workerId }));
        await supabase.from('Projects').update({ foreman_worker_id: workerId }).eq('id', id);
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

    const addMasterItem = async () => {
        if (!activeProjectId) return;

        const newItemInfo = {
            projectId: activeProjectId,
            name: '新規作業項目',
            target_hours: 0,
            estimated_amount: 0,
            order: activeProject.masterData.length + 1,
            progress_percentage: 0
        };

        const { data, error } = await supabase.from('ProjectTasks').insert([newItemInfo]).select();
        if (error) {
            console.error(error);
            window.alert("項目の追加に失敗しました。");
            return;
        }

        const dbRec = data[0];
        updateLayer(p => ({
            masterData: [...p.masterData, { id: dbRec.id, task: dbRec.name, target: dbRec.target_hours, estimatedAmount: dbRec.estimated_amount || 0 }],
            progressData: { ...p.progressData, [dbRec.id]: 0 }
        }));
    };

    const removeMasterItem = async (taskId) => {
        if (!window.confirm("この作業項目を削除すると、紐づく実績データもすべて削除されます。\n本当によろしいですか？")) return;

        const { error } = await supabase.from('ProjectTasks').delete().eq('id', taskId);
        if (error) {
            console.error(error);
            window.alert("項目の削除に失敗しました。");
            return;
        }

        updateLayer(p => ({
            masterData: p.masterData.filter(m => m.id !== taskId),
            records: p.records.filter(r => r.taskId !== taskId),
            // progressData is a dictionary, no strict need to delete the key here, but it's cleaner
        }));
    };

    const saveProgressDB = async (dbItemId, value) => {
        if (String(dbItemId).startsWith('temp-')) return;
        await supabase.from('ProjectTasks').update({ progress_percentage: value }).eq('id', dbItemId);
    };

    const addRecord = async () => {
        const defaultTaskId = activeProject.masterData[0]?.id;
        if (!defaultTaskId) {
            window.alert("先に工事設定で作業項目を登録してください");
            return;
        }

        const date = new Date().toISOString().split('T')[0];

        const { data, error } = await supabase.from('TaskRecords').insert([{
            project_task_id: defaultTaskId,
            project_id: activeProjectId,
            date: date,
            worker_name: workers.length > 0 ? workers[0].name : '',
            hours: 0,
            note: ''
        }]).select();

        if (error) {
            console.error(error);
            window.alert("日報の追加に失敗しました。");
            return;
        }

        const dbRec = data[0];
        updateLayer(p => ({
            records: [{ id: dbRec.id, date: dbRec.date, taskId: dbRec.project_task_id, worker: dbRec.worker_name, hours: dbRec.hours, note: dbRec.note }, ...p.records]
        }));
    };

    // --- 作業員マスター連携アクション ---
    const addWorker = async () => {
        const newWorkerName = window.prompt("追加する作業員の名前を入力してください");
        if (!newWorkerName || newWorkerName.trim() === '') return;

        const maxOrder = workers.length > 0 ? Math.max(...workers.map(w => w.display_order || 0)) : 0;

        const { data, error } = await supabase.from('Workers').insert([{
            name: newWorkerName.trim(),
            display_order: maxOrder + 1
        }]).select();

        if (error) {
            console.error(error);
            window.alert("作業員の追加に失敗しました。");
            return;
        }

        setWorkers(prev => [...prev, data[0]]);
    };

    const updateWorkerName = async (workerId, newName) => {
        if (!newName || newName.trim() === '') return;
        const { error } = await supabase.from('Workers').update({ name: newName.trim() }).eq('id', workerId);

        if (error) {
            console.error(error);
            window.alert("作業員名の更新に失敗しました。");
            return;
        }

        setWorkers(prev => prev.map(w => w.id === workerId ? { ...w, name: newName.trim() } : w));
    };

    const removeWorker = async (workerId, workerName) => {
        if (!window.confirm(`「${workerName}」を削除しますか？\n（※過去の実績データから名前は消えませんが、ログイン画面等の選択肢からは消去されます）`)) return;

        const { error } = await supabase.from('Workers').delete().eq('id', workerId);
        if (error) {
            console.error(error);
            window.alert("作業員の削除に失敗しました。");
            return;
        }

        setWorkers(prev => prev.filter(w => w.id !== workerId));
    };

    const moveWorkerOrder = async (index, direction) => {
        if (
            (direction === -1 && index === 0) ||
            (direction === 1 && index === workers.length - 1)
        ) return;

        const newWorkers = [...workers];
        const temp = newWorkers[index];
        newWorkers[index] = newWorkers[index + direction];
        newWorkers[index + direction] = temp;

        // display_orderを振り直す
        const updatedWorkers = newWorkers.map((w, i) => ({ ...w, display_order: i + 1 }));
        setWorkers(updatedWorkers);

        // DB更新 (複数件更新)
        for (const w of updatedWorkers) {
            await supabase.from('Workers').update({ display_order: w.display_order }).eq('id', w.id);
        }
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

    const addSubcontractorRecord = async () => {
        const newDbRecord = {
            project_id: activeProjectId,
            date: new Date().toISOString().split('T')[0],
            company_name: '',
            worker_count: 1,
            unit_price: 25000,
            worker_name: ''
        };

        const { data, error } = await supabase.from('SubcontractorRecords').insert([newDbRecord]).select();
        if (error) { console.error(error); return; }

        updateLayer(p => ({ subcontractors: [data[0], ...(p.subcontractors || [])] }));
    };

    const removeSubcontractorRecord = async (recordId) => {
        const { error } = await supabase.from('SubcontractorRecords').delete().eq('id', recordId);
        if (error) { console.error(error); return; }
        updateLayer(p => ({ subcontractors: (p.subcontractors || []).filter(r => r.id !== recordId) }));
    };

    const updateSubcontractorRecordField = async (recordId, field, value) => {
        updateLayer(p => ({
            subcontractors: (p.subcontractors || []).map(r => r.id === recordId ? { ...r, [field]: value } : r)
        }));
        await supabase.from('SubcontractorRecords').update({ [field]: value }).eq('id', recordId);
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
                            let estimatedAmount = 0;
                            if (typeof amount === 'number' && amount > 0) {
                                estimatedAmount = amount;
                                targetHours = Math.round(amount / HOURLY_WAGE);
                            }

                            newMasterData.push({ task: taskName, target: targetHours, estimatedAmount: estimatedAmount }); // DB用なのでID持たせず
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
                    window.alert('取り込めるデータが見つかりませんでした。');
                }
            } catch (error) {
                console.error('Excelパースエラー:', error);
                window.alert('エラーが発生しました。');
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
            const nextOrder = projects.length > 0 ? Math.max(...projects.map(p => p.order || 0)) + 1 : 0;

            if (choice === 'create_new') {
                const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: nextOrder }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'create_alias') {
                const { data, error } = await supabase.from('Projects').insert([{ name: aliasName || 'エクセル取込現場', order: nextOrder }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'overwrite' || choice === 'overwrite_empty') {
                targetProjectId = directParams ? directParams.projId : activeProjectId;
                if (!targetProjectId) {
                    const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: nextOrder }]).select();
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
                estimated_amount: m.estimatedAmount || 0,
                order: idx + 1,
                progress_percentage: 0
            }));

            await supabase.from('ProjectTasks').insert(tasksToInsert);

            // DBから最新を再フェッチ
            await fetchAllData(targetProjectId);

        } catch (e) {
            console.error(e);
            window.alert("DB保存中にエラーが発生しました");
        } finally {
            setIsLoading(false);
            setImportModalInfo(null);
            setAliasName("");
        }
    };
    // --- 全体ダッシュボード集計ロジック ---
    const allProjectsSummary = useMemo(() => {
        return projects.map(proj => {
            const masterData = proj.masterData || [];
            const records = proj.records || [];
            const progressData = proj.progressData || {};

            let totalActual = 0;
            let totalTarget = 0;
            let totalPredictedLoss = 0;

            masterData.forEach(m => {
                const actual = records.filter(r => r.taskId === m.id).reduce((sum, r) => sum + Number(r.hours), 0);
                const progress = progressData[m.id] || 0;
                const predictedFinal = progress > 0 ? (actual / (progress / 100)) : 0;
                const predictedProfitLoss = progress > 0 ? (m.target - predictedFinal) * HOURLY_WAGE : 0;

                totalActual += actual;
                totalTarget += m.target;
                totalPredictedLoss += predictedProfitLoss;
            });

            const overallProgressValue = totalTarget > 0 ? (masterData.reduce((sum, m) => sum + ((progressData[m.id] || 0) * m.target), 0) / totalTarget) : 0;
            const subcontractorCost = (proj.subcontractors || []).reduce((sum, s) => sum + (Number(s.worker_count) * Number(s.unit_price || 25000)), 0);

            return {
                ...proj,
                totalActual,
                totalTarget,
                overallProgress: Math.round(overallProgressValue),
                predictedProfitLoss: totalPredictedLoss - subcontractorCost
            };
        });
    }, [projects]);

    const exportToExcel = () => {
        if (!activeProject || !activeProject.masterData || activeProject.masterData.length === 0) {
            window.alert('出力するデータがありません。');
            return;
        }

        // --- シート1: 現場別サマリー (選択中現場) ---
        // 算出済みの activeProject (allProjectsSummary 内の該当データに相当するもの) を用いる
        const currentProjectSummary = allProjectsSummary.find(p => p.id === activeProject.id);
        const ownWorkerHours = currentProjectSummary ? currentProjectSummary.totalActual : 0;
        const ownWorkerCount = ownWorkerHours / 8; // 8時間 = 1人工
        const subcontractorCount = (activeProject.subcontractors || []).reduce((sum, s) => sum + Number(s.worker_count), 0);
        const totalWorkerCount = ownWorkerCount + subcontractorCount;
        const profitLoss = currentProjectSummary ? currentProjectSummary.predictedProfitLoss : 0;
        const progress = currentProjectSummary ? currentProjectSummary.overallProgress : 0;

        const summarySheetData = [
            {
                '現場名': activeProject.siteName,
                '予測粗利': profitLoss,
                '自社稼働時間合計(h)': ownWorkerHours,
                '自社延べ人数(人)': Number(ownWorkerCount.toFixed(2)),
                '協力業者延べ人数(人)': subcontractorCount,
                '総・延べ人数(人)': Number(totalWorkerCount.toFixed(2)),
                '進捗率(%)': progress
            }
        ];

        // --- シート2: 作業項目別詳細 (選択中現場) ---
        // 算出済みの summaryData.items を元にする
        const detailSheetData = summaryData.items.map(item => ({
            '現場名': activeProject.siteName,
            '作業項目名': item.task,
            '見積金額(円)': item.estimatedAmount,
            '進捗率(%)': item.progress,
            '目標工数(h)': item.target,
            '消化工数(h)': item.actual,
            '自社延べ人数(人)': Number((item.actual / 8).toFixed(2)),
            '予測粗利': item.predictedProfitLoss
        }));

        const wb = xlsx.utils.book_new();
        const ws1 = xlsx.utils.json_to_sheet(summarySheetData);
        const ws2 = xlsx.utils.json_to_sheet(detailSheetData);

        // スタイル設定
        const borderStyle = {
            top: { style: "thin" },
            bottom: { style: "thin" },
            left: { style: "thin" },
            right: { style: "thin" }
        };
        const headerStyle = {
            font: { bold: true },
            fill: { fgColor: { rgb: "EFEFEF" } }, // 薄いグレー
            border: borderStyle
        };
        const dataStyle = {
            border: borderStyle
        };

        const applyStyleToSheet = (ws) => {
            if (!ws['!ref']) return;
            const range = xlsx.utils.decode_range(ws['!ref']);
            for (let R = range.s.r; R <= range.e.r; ++R) {
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cellRef = xlsx.utils.encode_cell({ r: R, c: C });
                    if (!ws[cellRef]) continue;
                    if (R === 0) {
                        ws[cellRef].s = headerStyle;
                    } else {
                        ws[cellRef].s = Object.assign({}, ws[cellRef].s || {}, dataStyle);
                    }
                }
            }
        };

        applyStyleToSheet(ws1);
        applyStyleToSheet(ws2);

        // 列幅の簡易調整
        ws1['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 10 }];
        ws2['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];

        xlsx.utils.book_append_sheet(wb, ws1, "現場サマリー");
        xlsx.utils.book_append_sheet(wb, ws2, "作業項目別詳細");

        const today = new Date().toISOString().split('T')[0];
        xlsx.writeFile(wb, `${activeProject.siteName}_工数管理レポート_${today}.xlsx`);
    };

    const exportWorkerReport = async () => {
        if (!exportModalWorker || !exportWeekStart) return;
        setIsLoading(true);

        try {
            const startDate = new Date(exportWeekStart);
            const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                return d.toISOString().split('T')[0];
            });

            const workerName = exportModalWorker;
            const weekPrefix = exportWeekStart.replace(/-/g, '').slice(0, 8); // e.g., 20260302

            // Fetch records for this week
            const { data: recordsData } = await supabase.from('TaskRecords')
                .select('*, ProjectTasks(name, projectId)')
                .eq('worker_name', workerName)
                .gte('date', days[0])
                .lte('date', days[6]);

            // Check if foreman in any selected projects
            const foremanProjects = projects.filter(p => p.foreman_worker_id === workers.find(w => w.name === workerName)?.id);
            const foremanProjectIds = foremanProjects.map(p => p.id);
            let subcontractorsData = [];
            if (foremanProjectIds.length > 0) {
                const { data: subData } = await supabase.from('SubcontractorRecords')
                    .select('*')
                    .in('project_id', foremanProjectIds)
                    .gte('date', days[0])
                    .lte('date', days[6]);
                if (subData) subcontractorsData = subData;
            }

            const sheetData = [];
            sheetData.push(["就労日報 (R8)", null, null, null, null, `作業者名: ${workerName}`, null, null]);

            const dateRow = ["日付", "項目"];
            const dayNames = ["(月)", "(火)", "(水)", "(木)", "(金)", "(土)", "(日)"];
            days.forEach((d, i) => {
                const parts = d.split('-');
                dateRow.push(`${parseInt(parts[1])}/${parseInt(parts[2])}\n${dayNames[i]}`);
            });
            sheetData.push(dateRow);

            const dateProjectMap = {};
            days.forEach(d => {
                const dayRecords = (recordsData || []).filter(r => r.date === d);
                const projGroups = {};
                dayRecords.forEach(r => {
                    const pid = r.ProjectTasks?.projectId || r.project_id;
                    if (!projGroups[pid]) {
                        const proj = projects.find(p => p.id === pid);
                        projGroups[pid] = { siteName: proj?.siteName || '不明な現場', items: [], sumHours: 0, sumOvertime: 0 };
                    }
                    projGroups[pid].items.push(r.ProjectTasks?.name || '不明な作業');
                    projGroups[pid].sumHours += Number(r.hours || 0);
                    projGroups[pid].sumOvertime += Number(r.overtime_hours || 0);
                });
                dateProjectMap[d] = Object.values(projGroups);
            });

            for (let g = 0; g < 3; g++) {
                const genbaNameRow = [`現場${g + 1}`, "現場名"];
                const timeRow = ["", "時間"];
                const contentRow = ["", "作業内容"];

                days.forEach(d => {
                    const group = dateProjectMap[d][g];
                    if (group) {
                        genbaNameRow.push(group.siteName);
                        // 時間外がある場合は併記する
                        let otText = '';
                        if (group.sumOvertime > 0) {
                            otText = `\n(+外${group.sumOvertime}h)`;
                        }
                        timeRow.push(`${group.sumHours}h${otText}`);
                        contentRow.push(group.items.join('\n'));
                    } else {
                        genbaNameRow.push("");
                        timeRow.push("");
                        contentRow.push("");
                    }
                });
                sheetData.push(genbaNameRow);
                sheetData.push(timeRow);
                sheetData.push(contentRow);
            }

            for (let c = 0; c < 3; c++) {
                const compRow = c === 0 ? ["協力会社", `会社名①`] : ["", `会社名${c === 1 ? '②' : '③'}`];
                days.forEach(d => {
                    const daySubs = subcontractorsData.filter(s => s.date === d);
                    const sub = daySubs[c];
                    if (sub) {
                        compRow.push(`${sub.company_name} ( ${sub.worker_count}名 )`);
                    } else {
                        compRow.push("");
                    }
                });
                sheetData.push(compRow);
            }

            const pRow1 = ["使用材料", "材料名"];
            const pRow2 = ["", "数量"];
            for (let i = 0; i < 7; i++) { pRow1.push(""); pRow2.push(""); }
            sheetData.push(pRow1);
            sheetData.push(pRow2);

            const otRow = ["作業手当", "時間(H)"];
            days.forEach(d => {
                const dayRecords = (recordsData || []).filter(r => r.date === d);
                const dayOt = dayRecords.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0);
                otRow.push(dayOt > 0 ? `${dayOt}H` : "");
            });
            sheetData.push(otRow);

            const sigRow = ["", "承認サイン"];
            for (let i = 0; i < 7; i++) { sigRow.push(""); }
            sheetData.push(sigRow);

            sheetData.push(["備考", "※手当対象作業：...サンダーケレン、早出・残業（残業予定時間を事前に報告のこと）...", "", "", "", "", "", ""]);

            const ws = xlsx.utils.aoa_to_sheet(sheetData);

            ws['!merges'] = [
                { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
                { s: { r: 0, c: 5 }, e: { r: 0, c: 8 } },

                { s: { r: 2, c: 0 }, e: { r: 4, c: 0 } },
                { s: { r: 5, c: 0 }, e: { r: 7, c: 0 } },
                { s: { r: 8, c: 0 }, e: { r: 10, c: 0 } },

                { s: { r: 11, c: 0 }, e: { r: 13, c: 0 } },
                { s: { r: 14, c: 0 }, e: { r: 15, c: 0 } },
                { s: { r: 16, c: 0 }, e: { r: 17, c: 0 } },
                { s: { r: 18, c: 1 }, e: { r: 18, c: 8 } }
            ];

            const range = xlsx.utils.decode_range(ws['!ref']);
            for (let R = range.s.r; R <= range.e.r; ++R) {
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = ws[xlsx.utils.encode_cell({ r: R, c: C })];
                    if (!cell) ws[xlsx.utils.encode_cell({ r: R, c: C })] = { t: "s", v: "" };
                    const cellRef = ws[xlsx.utils.encode_cell({ r: R, c: C })];

                    if (R < 18) {
                        cellRef.s = {
                            border: {
                                top: { style: "thin" },
                                bottom: { style: "thin" },
                                left: { style: "thin" },
                                right: { style: "thin" }
                            },
                            alignment: { vertical: "center", horizontal: "center", wrapText: true }
                        };
                    } else if (R === 18) {
                        cellRef.s = { font: { sz: 9 } };
                    }

                    if (R === 0) {
                        cellRef.s.font = { bold: true, sz: 14 };
                        cellRef.s.border = {};
                        cellRef.s.alignment = { horizontal: C === 0 ? "center" : "right" };
                    }
                }
            }

            ws['!cols'] = [
                { wch: 6 },
                { wch: 10 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 }
            ];

            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws, "就労日報");
            xlsx.writeFile(wb, `${workerName}_就労日報_${weekPrefix}.xlsx`);

            setExportModalWorker(null);

        } catch (e) {
            console.error(e);
            window.alert("出力処理中にエラーが発生しました。");
        } finally {
            setIsLoading(false);
        }
    };

    // 作業員別の稼働実績集計
    const workerSummaryData = useMemo(() => {
        // すべてのプロジェクトの全レコードをフラット化
        const allRecords = projects.flatMap(p =>
            p.records.map(r => ({ ...r, siteName: p.siteName }))
        );

        // 作業員名でグループ化
        const summary = {};
        allRecords.forEach(r => {
            if (!r.worker) return;
            if (!summary[r.worker]) {
                summary[r.worker] = { totalHours: 0, projects: new Set() };
            }
            summary[r.worker].totalHours += Number(r.hours) || 0;
            if (r.siteName) {
                summary[r.worker].projects.add(r.siteName);
            }
        });

        // 配列に変換し、労働時間の多い順などにソート可能にする（今回は名前順）
        return Object.entries(summary).map(([name, data]) => ({
            name,
            totalHours: data.totalHours,
            projects: Array.from(data.projects).sort()
        })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [projects]);

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
        const subcontractorCost = (activeProject.subcontractors || []).reduce((sum, s) => sum + (Number(s.worker_count) * Number(s.unit_price || 25000)), 0);

        return {
            items,
            totalActual,
            totalTarget,
            totalPredictedProfitLoss: totalPredictedProfitLoss - subcontractorCost,
            subcontractorCost
        };
    }, [activeProject.masterData, activeProject.records, activeProject.progressData, activeProject.subcontractors]);

    if (isLoading && projects.length === 0) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
            <div className="max-w-6xl mx-auto">
                <header className="mb-6">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="flex-1">
                            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-3 cursor-pointer hover:opacity-80 transition" onClick={() => setActiveTab('dashboard')}>
                                <BarChart3 className="text-blue-600" /> 詳細工数管理システム
                            </h1>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative flex items-center">
                                    <FolderGit2 className="absolute left-3 text-slate-400 w-4 h-4" />
                                    <select
                                        value={activeProjectId || ''}
                                        onChange={(e) => {
                                            setActiveProjectId(Number(e.target.value));
                                            if (activeTab === 'dashboard') setActiveTab('summary');
                                        }}
                                        className="pl-9 pr-8 py-2 bg-white border border-slate-300 rounded-lg shadow-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 appearance-none hover:border-slate-400 transition"
                                    >
                                        {projects.length === 0 && <option value="">現場なし</option>}
                                        {projects.map(p => (
                                            <option key={p.id} value={p.id}>{p.siteName || '無題の現場'}</option>
                                        ))}
                                    </select>
                                </div>
                                {['dashboard', 'master'].includes(activeTab) && (
                                    <button onClick={addNewProject} title="新しい現場を追加" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition shadow-sm border border-transparent hover:border-blue-200">
                                        <PlusCircle size={20} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <nav className="bg-white p-2 rounded-lg shadow-sm border flex gap-1 mt-2 md:mt-0 overflow-x-auto">
                            {['dashboard', 'summary', 'input', 'master', 'workers'].map((tab) => (
                                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-md transition font-bold whitespace-nowrap ${activeTab === tab ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
                                    {tab === 'dashboard' ? 'ホーム' : tab === 'summary' ? '管理シート' : tab === 'input' ? '実績入力' : tab === 'master' ? '工事設定' : '作業員'}
                                </button>
                            ))}
                        </nav>
                    </div>
                </header>

                <main className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden min-h-[500px]">
                    {isLoading && <div className="h-1 bg-blue-100 overflow-hidden"><div className="w-1/2 h-full bg-blue-500 animate-pulse"></div></div>}

                    {activeTab === 'dashboard' && (
                        <div className={`p-6 bg-slate-100 min-h-full ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Home className="text-blue-600" /> 登録済み工事一覧</h2>
                            </div>

                            {projects.length === 0 ? (
                                <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                                    <FolderGit2 className="mx-auto w-16 h-16 text-slate-300 mb-4" />
                                    <p className="text-slate-500 font-bold mb-4">まだ現場が登録されていません</p>
                                    <button onClick={addNewProject} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold shadow-md hover:bg-blue-700 transition flex items-center gap-2 mx-auto">
                                        <PlusCircle size={20} /> 新しい現場を作成
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {allProjectsSummary.map(proj => (
                                        <div
                                            key={proj.id}
                                            onClick={() => {
                                                setActiveProjectId(proj.id);
                                                setActiveTab('summary');
                                            }}
                                            className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-blue-300 transition-all cursor-pointer overflow-hidden flex flex-col h-full group"
                                        >
                                            <div className="p-5 border-b border-slate-100 flex-1">
                                                <h3 className="font-bold text-lg text-slate-800 line-clamp-2 leading-tight flex items-start group-hover:text-blue-700 transition-colors">
                                                    {proj.siteName}
                                                </h3>
                                                <div className="mt-2 flex items-center gap-1 text-sm text-slate-500 font-medium">
                                                    <User size={14} className="text-slate-400" />
                                                    職長: {
                                                        proj.foreman_worker_id
                                                            ? (workers.find(w => w.id === proj.foreman_worker_id)?.name || '未設定')
                                                            : '未設定'
                                                    }
                                                </div>
                                            </div>
                                            <div className="p-5 flex flex-col gap-4 bg-slate-50">
                                                <div>
                                                    <div className="flex justify-between text-xs font-bold text-slate-500 mb-1">
                                                        <span>全体進捗</span>
                                                        <span className="text-blue-600">{proj.overallProgress}%</span>
                                                    </div>
                                                    <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                                                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, proj.overallProgress))}%` }}></div>
                                                    </div>
                                                </div>

                                                <div className="flex items-end justify-between mt-auto">
                                                    <div>
                                                        <div className="text-[10px] font-bold text-slate-400 mb-1">消化工数 / 目標</div>
                                                        <div className="font-mono text-lg font-bold text-slate-700">
                                                            {proj.totalActual}<span className="text-xs font-normal">h</span> <span className="text-slate-300 mx-1">/</span> {proj.totalTarget}<span className="text-xs font-normal">h</span>
                                                        </div>
                                                    </div>
                                                    <div className={`text-right ${proj.predictedProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                        <div className="text-[10px] font-bold opacity-70 mb-1">予測粗利</div>
                                                        <div className="font-black flex items-center gap-1 justify-end">
                                                            {proj.predictedProfitLoss >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                                            ¥{Math.abs(Math.round(proj.predictedProfitLoss)).toLocaleString()}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

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

                                <div className="bg-orange-50 p-6 rounded-2xl border border-orange-200 flex flex-col justify-center">
                                    <div className="text-xs font-bold text-orange-600 mb-1 uppercase tracking-wider">協力業者 発生コスト (累計)</div>
                                    <div className="text-2xl font-black text-orange-600 flex items-baseline gap-2">
                                        ¥{Math.round(summaryData.subcontractorCost || 0).toLocaleString()}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mb-4 border-b pb-4">
                                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800"><Layout className="text-blue-500 w-5 h-5" /> 項目別詳細予測</h2>
                                <button
                                    onClick={exportToExcel}
                                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-green-700 shadow-sm border border-green-700"
                                >
                                    <Clipboard size={16} /> Excel出力
                                </button>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b text-slate-600 text-sm">
                                            <th className="p-4 font-bold">作業項目</th>
                                            <th className="p-4 font-bold text-right">見積金額</th>
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
                                                <td className="p-4 text-right">
                                                    <div className="font-mono font-bold text-slate-800">¥{Math.round(item.estimatedAmount).toLocaleString()}</div>
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
                            <div className="overflow-x-auto mb-8">
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

                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-lg font-bold flex items-center gap-2 text-orange-600"><Edit3 size={20} /> 協力業者実績入力</h2>
                                <button onClick={addSubcontractorRecord} className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-orange-700 shadow-md"><Plus size={16} /> 業者1件追加</button>
                            </div>
                            <div className="overflow-x-auto pb-32">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-orange-50 border-b border-orange-200 text-orange-800 font-bold">
                                        <tr>
                                            <th className="p-3 w-32">日付</th>
                                            <th className="p-3">会社名</th>
                                            <th className="p-3 w-24">人数(人)</th>
                                            <th className="p-3">入力者(任意)</th>
                                            <th className="p-3"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(activeProject.subcontractors || []).map((r, i) => (
                                            <tr key={r.id} className="border-b hover:bg-orange-50 transition">
                                                <td className="p-2">
                                                    <input
                                                        type="date"
                                                        value={r.date}
                                                        className="border border-orange-200 rounded p-1 w-full text-xs"
                                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'date', e.target.value)}
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <input
                                                        type="text"
                                                        value={r.company_name || ""}
                                                        placeholder="会社名を入力"
                                                        className="border border-orange-200 rounded p-1 w-full text-xs outline-none focus:border-orange-400"
                                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'company_name', e.target.value)}
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <input
                                                        type="number"
                                                        min="0.1"
                                                        step="0.1"
                                                        value={r.worker_count}
                                                        className="border border-orange-200 rounded p-1 w-full text-right font-bold text-xs"
                                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'worker_count', Number(e.target.value))}
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <input
                                                        type="text"
                                                        value={r.worker_name || ""}
                                                        placeholder="職長名など"
                                                        className="border border-orange-200 rounded p-1 w-full text-xs outline-none focus:border-orange-400"
                                                        onChange={(e) => updateSubcontractorRecordField(r.id, 'worker_name', e.target.value)}
                                                    />
                                                </td>
                                                <td className="p-2 text-center">
                                                    <button onClick={() => removeSubcontractorRecord(r.id)} className="text-orange-300 hover:text-red-500 transition"><Trash2 size={16} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                        {(!activeProject.subcontractors || activeProject.subcontractors.length === 0) && (
                                            <tr>
                                                <td colSpan="5" className="p-6 text-center text-slate-400 font-bold border-b border-dashed">
                                                    協力業者の実績データはありません
                                                </td>
                                            </tr>
                                        )}
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
                                    className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-xl outline-none focus:border-blue-500 mb-4"
                                />
                                <label className="text-xs font-bold text-blue-600 block mb-2 uppercase">担当職長</label>
                                <select
                                    value={activeProject.foreman_worker_id || ''}
                                    onChange={(e) => handleForemanChange(activeProject.id, e.target.value)}
                                    className="w-full bg-white p-3 rounded-lg border-2 border-blue-200 font-bold text-lg outline-none focus:border-blue-500"
                                >
                                    <option value="">（未設定）</option>
                                    {workers.map(w => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
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

                    {activeTab === 'workers' && (
                        <div className={`p-6 bg-slate-50 min-h-[500px] ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
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
                                            <div key={worker.id} className="flex flex-col sm:flex-row items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg hover:border-blue-300 transition group">
                                                <div className="flex items-center gap-3 w-full sm:w-auto mb-2 sm:mb-0">
                                                    <div className="flex flex-col">
                                                        <button
                                                            disabled={idx === 0}
                                                            onClick={() => moveWorkerOrder(idx, -1)}
                                                            className="text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-300 p-0.5"
                                                        >
                                                            <ArrowUp size={16} />
                                                        </button>
                                                        <button
                                                            disabled={idx === workers.length - 1}
                                                            onClick={() => moveWorkerOrder(idx, 1)}
                                                            className="text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-300 p-0.5"
                                                        >
                                                            <ArrowDown size={16} />
                                                        </button>
                                                    </div>
                                                    <span className="text-xs text-slate-400 font-mono w-4">{idx + 1}</span>
                                                    <input
                                                        type="text"
                                                        defaultValue={worker.name}
                                                        onBlur={(e) => updateWorkerName(worker.id, e.target.value)}
                                                        className="font-bold text-lg bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white outline-none px-1 py-0.5 transition w-full sm:w-48"
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => removeWorker(worker.id, worker.name)}
                                                    className="w-full sm:w-auto mt-2 sm:mt-0 opacity-100 sm:opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-500 hover:bg-red-50 p-2 rounded transition flex items-center justify-center gap-1"
                                                >
                                                    <Trash2 size={16} /> <span className="sm:hidden text-sm">削除</span>
                                                </button>
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
                    )}
                </main>

                {/* 作業員別日報出力モーダル */}
                {exportModalWorker && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
                            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <FileText className="text-blue-500" />
                                就労日報の出力
                            </h3>
                            <p className="text-slate-600 mb-6 font-bold text-sm">
                                対象作業員: <span className="text-blue-600 text-base">{exportModalWorker}</span> さん
                            </p>

                            <div className="mb-6">
                                <label className="block text-xs font-bold text-slate-500 mb-2">出力する週（月曜始まり）</label>
                                <input
                                    type="date"
                                    value={exportWeekStart}
                                    onChange={(e) => {
                                        const d = new Date(e.target.value);
                                        const day = d.getDay();
                                        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                                        setExportWeekStart(new Date(d.setDate(diff)).toISOString().split('T')[0]);
                                    }}
                                    className="w-full border-2 border-slate-200 p-3 rounded-lg font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                />
                            </div>

                            <div className="flex gap-3 justify-end mt-4">
                                <button
                                    onClick={() => setExportModalWorker(null)}
                                    className="px-4 py-2 rounded-lg font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition"
                                >キャンセル</button>
                                <button
                                    onClick={exportWorkerReport}
                                    className="px-4 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition"
                                >
                                    Excel出力
                                </button>
                            </div>
                        </div>
                    </div>
                )}

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
