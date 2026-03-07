import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Layout, Table, Clipboard, AlertCircle, Plus, Trash2, CheckCircle2, BarChart3, Settings, Edit3, Home, TrendingDown, TrendingUp, DollarSign, FolderGit2, PlusCircle, Trash, Upload, Loader2, User, Users, ArrowUp, ArrowDown, FileText, Calendar } from 'lucide-react';
import { supabase } from './lib/supabase';
import { DEFAULT_MASTER_DATA } from './utils/constants';
import { calculateAge } from './utils/dateUtils';
import { calculateProjectsSummary } from './utils/projectUtils';
import { parseExcelForImport } from './utils/excelImportUtils';
import { exportToExcel, generateWorkerReportExcel } from './utils/excelExportUtils';
import ImportModal from './components/ImportModal';
import WorkerEditModal from './components/WorkerEditModal';
import ExportReportModal from './components/ExportReportModal';
import DashboardTab from './components/tabs/DashboardTab';
import InputTab from './components/tabs/InputTab';
import MasterTab from './components/tabs/MasterTab';
import WorkersTab from './components/tabs/WorkersTab';
import SystemSettingsTab from './components/tabs/SystemSettingsTab';

const App = () => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [importModalInfo, setImportModalInfo] = useState(null);
    const [aliasName, setAliasName] = useState("");

    // ホーム画面用フィルタ＆ソート
    const [filterStatuses, setFilterStatuses] = useState(['予定', '施工中', '完了']);
    const [sortOption, setSortOption] = useState('created_desc');
    const [workers, setWorkers] = useState([]);
    const [focusedWorkerRow, setFocusedWorkerRow] = useState(null);
    const [exportModalWorker, setExportModalWorker] = useState(null);
    const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);
    const [editingWorker, setEditingWorker] = useState(null);
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
    const [hourlyWage, setHourlyWage] = useState(3500);

    // -- 起動時のデータ取得 --
    const fetchAllData = async (forceActiveId = null) => {
        if (!supabase) return;
        setIsLoading(true);
        try {
            // Workers取得
            const { data: wData } = await supabase.from('Workers').select('*').order('display_order', { ascending: true, nullsFirst: false });
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

            const { data: settingsData, error: settingsError } = await supabase.from('system_settings').select('hourly_wage').eq('id', 1).single();
            if (!settingsError && settingsData) {
                setHourlyWage(settingsData.hourly_wage);
            }

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
                    status: p.status || '予定',
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
        const { data, error } = await supabase.from('Projects').insert([{ name: '新規の現場', order: nextOrder, status: '予定' }]).select();
        if (error) {
            console.error(error);
            alert('現場の作成に失敗しました: ' + error.message);
            return;
        }
        const newProj = data[0];

        setProjects(prev => [...prev, {
            id: newProj.id, order: newProj.order, siteName: newProj.name, status: newProj.status || '予定', masterData: [], records: [], progressData: {}
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

    const handleProjectStatusChange = async (id, newStatus) => {
        updateLayer(p => ({ status: newStatus }));
        await supabase.from('Projects').update({ status: newStatus }).eq('id', id);
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
    const addWorker = () => {
        setEditingWorker({
            name: '', kana: '', birthDate: '', hireDate: '', address: '', contactInfo: '', cpdsNumber: ''
        });
        setIsWorkerModalOpen(true);
    };

    const openEditWorkerModal = (worker) => {
        setEditingWorker({ ...worker });
        setIsWorkerModalOpen(true);
    };

    const saveWorker = async () => {
        if (!editingWorker.name || editingWorker.name.trim() === '') {
            window.alert('名前は必須です。');
            return;
        }

        try {
            const workerDataToSave = {
                name: editingWorker.name.trim(),
                kana: editingWorker.kana || null,
                birthDate: editingWorker.birthDate || null,
                hireDate: editingWorker.hireDate || null,
                address: editingWorker.address || null,
                contactInfo: editingWorker.contactInfo || null,
                cpdsNumber: editingWorker.cpdsNumber || null
            };

            if (editingWorker.id) {
                // Update
                const { error } = await supabase.from('Workers').update(workerDataToSave).eq('id', editingWorker.id);
                if (error) throw error;
                setWorkers(prev => prev.map(w => w.id === editingWorker.id ? { ...w, ...workerDataToSave } : w));
            } else {
                // Insert
                const maxOrder = workers.length > 0 ? Math.max(...workers.map(w => w.display_order || 0)) : 0;
                const { data, error } = await supabase.from('Workers').insert([{
                    ...workerDataToSave,
                    display_order: maxOrder + 1
                }]).select();
                if (error) throw error;
                setWorkers(prev => [...prev, data[0]]);
            }
            setIsWorkerModalOpen(false);
            setEditingWorker(null);
        } catch (error) {
            console.error(error);
            window.alert("作業員の保存に失敗しました。");
        }
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

        const workerA = workers[index];
        const workerB = workers[index + direction];

        let orderA = workerA.display_order;
        let orderB = workerB.display_order;

        if (!orderA) orderA = Date.now() + index;
        if (!orderB) orderB = Date.now() + index + direction;

        // UIを即時反映（位置を入れ替え、display_order属性も入れ替える）
        const newWorkers = [...workers];
        newWorkers[index] = { ...workerB, display_order: orderA };
        newWorkers[index + direction] = { ...workerA, display_order: orderB };
        setWorkers(newWorkers);

        // DB更新（Unique制約エラーを避けるため、Aを退避 -> BをAの位置へ -> AをBの位置へ）
        try {
            const tempOrder = -(Date.now() % 1000000000) - workerA.id;
            await supabase.from('Workers').update({ display_order: tempOrder }).eq('id', workerA.id);
            await supabase.from('Workers').update({ display_order: orderA }).eq('id', workerB.id);
            await supabase.from('Workers').update({ display_order: orderB }).eq('id', workerA.id);
        } catch (error) {
            console.error("順序の保存エラー:", error);
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
                                targetHours = Math.round(amount / hourlyWage);
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
                const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: nextOrder, status: '予定' }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'create_alias') {
                const { data, error } = await supabase.from('Projects').insert([{ name: aliasName || 'エクセル取込現場', order: nextOrder, status: '予定' }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'overwrite' || choice === 'overwrite_empty') {
                targetProjectId = directParams ? directParams.projId : activeProjectId;
                if (!targetProjectId) {
                    const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: nextOrder, status: '予定' }]).select();
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
        return calculateProjectsSummary(projects, hourlyWage);
    }, [projects, hourlyWage]);

    const handleExportToExcel = () => {
        if (!activeProject || !activeProject.masterData || activeProject.masterData.length === 0) {
            window.alert('出力するデータがありません。');
            return;
        }
        exportToExcel(activeProject, summaryData);
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

            generateWorkerReportExcel(workerName, weekPrefix, days, recordsData, projects, subcontractorsData);

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
            const predictedProfitLoss = progress > 0 ? (m.target - predictedFinal) * hourlyWage : 0;

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
    }, [activeProject.masterData, activeProject.records, activeProject.progressData, activeProject.subcontractors, hourlyWage]);

    const displayProjects = useMemo(() => {
        let list = allProjectsSummary.filter(p => filterStatuses.includes(p.status || '予定'));
        list.sort((a, b) => {
            if (sortOption === 'created_desc') return b.id - a.id;
            if (sortOption === 'created_asc') return a.id - b.id;
            if (sortOption === 'progress_desc') return b.overallProgress - a.overallProgress;
            if (sortOption === 'progress_asc') return a.overallProgress - b.overallProgress;
            if (sortOption === 'profit_desc') return b.predictedProfitLoss - a.predictedProfitLoss;
            if (sortOption === 'profit_asc') return a.predictedProfitLoss - b.predictedProfitLoss;
            return 0; // default order
        });
        return list;
    }, [allProjectsSummary, filterStatuses, sortOption]);

    const toggleFilterStatus = (status) => {
        setFilterStatuses(prev =>
            prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
        );
    };

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
                            {['dashboard', 'summary', 'input', 'master', 'workers', 'settings'].map((tab) => (
                                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-md transition font-bold whitespace-nowrap ${activeTab === tab ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
                                    {tab === 'dashboard' ? 'ホーム' : tab === 'summary' ? '管理シート' : tab === 'input' ? '実績入力' : tab === 'master' ? '工事設定' : tab === 'settings' ? 'システム設定' : '作業員'}
                                </button>
                            ))}
                        </nav>
                    </div>
                </header>

                <main className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden min-h-[500px]">
                    {isLoading && <div className="h-1 bg-blue-100 overflow-hidden"><div className="w-1/2 h-full bg-blue-500 animate-pulse"></div></div>}

                    {activeTab === 'dashboard' && (
                        <div className={`p-6 bg-slate-100 min-h-full ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Home className="text-blue-600" /> 登録済み工事一覧</h2>

                                {projects.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-slate-200">
                                        <div className="flex items-center gap-2 text-sm font-bold text-slate-600 md:border-r pr-4">
                                            <span className="text-slate-400">表示対象:</span>
                                            {['予定', '施工中', '完了'].map(status => (
                                                <label key={status} className="flex items-center gap-1 cursor-pointer hover:bg-slate-50 px-1 rounded transition">
                                                    <input
                                                        type="checkbox"
                                                        checked={filterStatuses.includes(status)}
                                                        onChange={() => toggleFilterStatus(status)}
                                                        className="w-4 h-4 accent-blue-600 cursor-pointer"
                                                    /> {status}
                                                </label>
                                            ))}
                                        </div>
                                        <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                                            <span className="text-slate-400">並び順:</span>
                                            <select
                                                value={sortOption}
                                                onChange={(e) => setSortOption(e.target.value)}
                                                className="bg-slate-50 border border-slate-200 rounded p-1 outline-none focus:border-blue-400 cursor-pointer font-bold text-slate-700"
                                            >
                                                <option value="created_desc">登録が新しい順</option>
                                                <option value="created_asc">登録が古い順</option>
                                                <option value="progress_desc">進捗率が高い順</option>
                                                <option value="progress_asc">進捗率が低い順</option>
                                                <option value="profit_desc">予測粗利が高い順</option>
                                                <option value="profit_asc">予測粗利が低い順</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
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
                                    {displayProjects.length === 0 ? (
                                        <div className="col-span-full text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 font-bold">該当する条件の現場がありません。</div>
                                    ) : displayProjects.map(proj => (
                                        <div
                                            key={proj.id}
                                            onClick={() => {
                                                setActiveProjectId(proj.id);
                                                setActiveTab('summary');
                                            }}
                                            className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-blue-300 transition-all cursor-pointer overflow-hidden flex flex-col h-full group"
                                        >
                                            <div className="p-5 border-b border-slate-100 flex-1 relative">
                                                <div className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border ${(proj.status || '予定') === '予定' ? 'bg-blue-50 text-blue-600 border-blue-200' : (proj.status || '予定') === '施工中' ? 'bg-green-50 text-green-600 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-300'}`}>
                                                    {proj.status || '予定'}
                                                </div>
                                                <h3 className="font-bold text-lg text-slate-800 line-clamp-2 leading-tight flex items-start group-hover:text-blue-700 transition-colors pr-12">
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
                        <DashboardTab
                            activeProject={activeProject}
                            summaryData={summaryData}
                            updateLayer={updateLayer}
                            saveProgressDB={saveProgressDB}
                            handleExportToExcel={() => exportToExcel(activeProject, summaryData)}
                            isLoading={isLoading}
                        />
                    )}

                    {activeTab === 'input' && (
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

                    {activeTab === 'master' && (
                        <MasterTab
                            activeProject={activeProject}
                            isLoading={isLoading}
                            handleExcelImport={handleExcelImport}
                            fileInputRef={fileInputRef}
                            removeProject={removeProject}
                            updateLayer={updateLayer}
                            handleSiteNameBlur={handleSiteNameBlur}
                            handleProjectStatusChange={handleProjectStatusChange}
                            handleForemanChange={handleForemanChange}
                            workers={workers}
                            updateMasterItemLocal={updateMasterItemLocal}
                            saveMasterItemDB={saveMasterItemDB}
                            removeMasterItem={removeMasterItem}
                            addMasterItem={addMasterItem}
                            HOURLY_WAGE={hourlyWage}
                        />
                    )}

                    {activeTab === 'workers' && (
                        <WorkersTab
                            isLoading={isLoading}
                            workers={workers}
                            addWorker={addWorker}
                            moveWorkerOrder={moveWorkerOrder}
                            openEditWorkerModal={openEditWorkerModal}
                            removeWorker={removeWorker}
                            workerSummaryData={workerSummaryData}
                            setExportModalWorker={setExportModalWorker}
                        />
                    )}

                    {activeTab === 'settings' && (
                        <SystemSettingsTab
                            hourlyWage={hourlyWage}
                            setHourlyWage={setHourlyWage}
                            isLoading={isLoading}
                            setIsLoading={setIsLoading}
                        />
                    )}
                </main>

                {/* 作業員別日報出力モーダル */}
                <ExportReportModal
                    isOpen={!!exportModalWorker}
                    workerName={exportModalWorker}
                    exportWeekStart={exportWeekStart}
                    setExportWeekStart={setExportWeekStart}
                    onClose={() => setExportModalWorker(null)}
                    onExport={exportWorkerReport}
                    isLoading={isLoading}
                />

                {/* エクセルインポート時の選択モーダル */}
                <ImportModal
                    info={importModalInfo}
                    isLoading={isLoading}
                    aliasName={aliasName}
                    setAliasName={setAliasName}
                    onChoice={handleImportChoice}
                    onCancel={() => {
                        setImportModalInfo(null);
                        setAliasName("");
                    }}
                />

                {/* 作業員詳細編集モーダル */}
                <WorkerEditModal
                    isOpen={isWorkerModalOpen}
                    editingWorker={editingWorker}
                    setEditingWorker={setEditingWorker}
                    onClose={() => {
                        setIsWorkerModalOpen(false);
                        setEditingWorker(null);
                    }}
                    onSave={saveWorker}
                />
            </div>
        </div>
    );
};

export default App;
