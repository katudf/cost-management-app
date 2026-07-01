import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSupabaseData } from './hooks/useSupabaseData';
import { useProjects } from './hooks/useProjects';
import { useWorkers } from './hooks/useWorkers';
import { useDashboardStats } from './hooks/useDashboardStats';

import { useToast } from './components/Toast';
import { Table, Clipboard, BarChart3, Settings, Home, TrendingDown, TrendingUp, DollarSign, FolderGit2, PlusCircle, Loader2, User, Users, FileText, Calendar, Search, Upload, GripVertical } from 'lucide-react';
import { supabase } from './lib/supabase';
import { DEFAULT_MASTER_DATA, PROJECT_STATUS, PROJECT_STATUS_LIST, PROJECT_STATUS_COLOR, ITEM_TYPE } from './utils/constants';
import { calculateAge } from './utils/dateUtils';
import { calculateProjectsSummary } from './utils/projectUtils';
import { parseExcelForImport } from './utils/excelImportUtils';
import { exportToExcel, generateWorkerReportExcel, generateMultipleWorkersReportExcel } from './utils/excelExportUtils';
import { generateWorkerReportPDF, generateMultipleWorkersReportPDF } from './utils/pdfExportUtils';
import { fetchApprovalsForReport } from './lib/overtimeApprovals';
import { fetchWorkAllowanceApprovalsForReport } from './lib/workAllowanceApprovals';
import { optimizeItemsWithGemini } from './utils/aiOptimizeUtils';
import ImportModal from './components/ImportModal';
import WorkerEditModal from './components/WorkerEditModal';
import ExportReportModal from './components/ExportReportModal';
import DashboardTab from './components/tabs/DashboardTab';
import InputTab from './components/tabs/InputTab';
import MasterTab from './components/tabs/MasterTab';
import WorkersTab from './components/tabs/WorkersTab';
import DailyReportTab from './components/tabs/DailyReportTab';
import SystemSettingsTab from './components/tabs/SystemSettingsTab';
import PurchaseLedgerTab from './components/tabs/PurchaseLedgerTab';
import AssignmentChartTab from './components/tabs/AssignmentChartTab';
import EstimateList from './EstimateList';
import EstimateForm from './EstimateForm';

const App = () => {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState('dashboard');
    const [estimateEditId, setEstimateEditId] = useState(undefined);
    // undefined = 一覧表示
    // null      = 新規作成フォーム
    // number    = 編集フォーム（IDを指定）
    const [importModalInfo, setImportModalInfo] = useState(null);
    const [aliasName, setAliasName] = useState("");


    const [activeProjectId, setActiveProjectId] = useState(null);
    const [dashboardPages, setDashboardPages] = useState(
        () => Object.fromEntries(PROJECT_STATUS_LIST.map(s => [s, 1]))
    );

    const [dashboardSubTab, setDashboardSubTab] = useState('all'); // 'all', 'estimate', 'completed'
    const [draggedProjectId, setDraggedProjectId] = useState(null);
    const [isDragOverTab, setIsDragOverTab] = useState({ all: false, estimate: false, completed: false });

    const handleTabDrop = async (targetSubTab) => {
        setIsDragOverTab({ all: false, estimate: false, completed: false });
        if (!draggedProjectId) return;

        const proj = projects.find(p => p.id === draggedProjectId);
        if (!proj) return;

        let newStatus = proj.status;
        let showOnHome = proj.show_on_home;

        if (targetSubTab === 'all') {
            showOnHome = true;
        } else if (targetSubTab === 'estimate') {
            newStatus = PROJECT_STATUS.ESTIMATE;
            showOnHome = false;
        } else if (targetSubTab === 'completed') {
            newStatus = PROJECT_STATUS.COMPLETED;
            showOnHome = false;
        }

        try {
            await projectOps.updateProjectVisibilityAndStatus(draggedProjectId, newStatus, showOnHome);
            showToast(`「${proj.siteName || '無題'}」を移動しました。`, 'success');
        } catch (error) {
            console.error('Drop update error:', error);
            showToast('プロジェクトの移動に失敗しました。', 'error');
        } finally {
            setDraggedProjectId(null);
        }
    };

    const [dragOverProjectId, setDragOverProjectId] = useState(null);
    const [dragOverPosition, setDragOverPosition] = useState('before'); // 'before' or 'after'

    const handleDragStart = (e, id) => {
        setDraggedProjectId(id);
    };

    const handleDragOverCard = (e, id) => {
        e.preventDefault();
        if (draggedProjectId === id) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const threshold = rect.height / 2;

        if (relativeY > threshold) {
            setDragOverPosition('after');
        } else {
            setDragOverPosition('before');
        }
        setDragOverProjectId(id);
    };

    const handleDragEnd = () => {
        setDraggedProjectId(null);
        setDragOverProjectId(null);
        setDragOverPosition('before');
        setIsDragOverTab({ all: false, estimate: false, completed: false });
    };

    const handleCardDrop = async (e, targetStatus, targetProjectId) => {
        e.preventDefault();
        e.stopPropagation();
        const position = dragOverPosition; // キャプチャ
        setDragOverProjectId(null);
        if (!draggedProjectId || draggedProjectId === targetProjectId) return;

        try {
            await projectOps.reorderAndMoveProjects(draggedProjectId, targetStatus, targetProjectId, position);
            showToast('プロジェクトの順序/ステータスを更新しました。', 'success');
        } catch (error) {
            console.error('Card drop error:', error);
            showToast('移動に失敗しました。', 'error');
        } finally {
            setDraggedProjectId(null);
        }
    };

    const handleColumnDrop = async (e, targetStatus) => {
        e.preventDefault();
        if (!draggedProjectId) return;

        // ドロップ先カラムの表示中プロジェクトを取得
        const rawProjects = groupedProjects[targetStatus] || [];
        let columnProjects = [];
        if (dashboardSubTab === 'all') {
            if (targetStatus === PROJECT_STATUS.ESTIMATE || targetStatus === PROJECT_STATUS.COMPLETED) {
                columnProjects = rawProjects.filter(p => p.show_on_home !== false);
            } else {
                columnProjects = rawProjects;
            }
        } else if (dashboardSubTab === 'estimate') {
            columnProjects = rawProjects.filter(p => p.show_on_home === false);
        } else if (dashboardSubTab === 'completed') {
            columnProjects = rawProjects.filter(p => p.show_on_home === false);
        }

        // ページネーションを考慮する
        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.max(1, Math.ceil(columnProjects.length / ITEMS_PER_PAGE));
        const currentPage = dashboardPages[targetStatus] || 1;
        const validPage = Math.min(Math.max(1, currentPage), totalPages);
        const startIndex = (validPage - 1) * ITEMS_PER_PAGE;
        const visibleProjects = columnProjects.slice(startIndex, startIndex + ITEMS_PER_PAGE);

        // 最後のプロジェクトがある場合、その直後に挿入する
        let targetProjectId = null;
        let position = 'after';

        if (visibleProjects.length > 0) {
            const lastProject = visibleProjects[visibleProjects.length - 1];
            // ドラッグ中のプロジェクト自体が末尾にいる場合は、その一つ前をターゲットにする
            if (lastProject.id === draggedProjectId) {
                if (visibleProjects.length > 1) {
                    targetProjectId = visibleProjects[visibleProjects.length - 2].id;
                } else {
                    targetProjectId = null;
                }
            } else {
                targetProjectId = lastProject.id;
            }
        }

        try {
            await projectOps.reorderAndMoveProjects(draggedProjectId, targetStatus, targetProjectId, position);
            showToast('プロジェクトの順序/ステータスを更新しました。', 'success');
        } catch (error) {
            console.error('Column drop error:', error);
            showToast('移動に失敗しました。', 'error');
        } finally {
            setDraggedProjectId(null);
        }
    };

    // タッチ端末向け：ドラッグせずにステータス（カラム）を変更する代替手段
    const handleStatusSelect = async (projectId, newStatus) => {
        const proj = projects.find(p => p.id === projectId);
        if (!proj || proj.status === newStatus) return;
        try {
            await projectOps.reorderAndMoveProjects(projectId, newStatus, null, 'after');
            showToast(`「${proj.siteName || '無題の現場'}」を${newStatus}に移動しました。`, 'success');
        } catch (error) {
            console.error('Status select error:', error);
            showToast('ステータスの変更に失敗しました。', 'error');
        }
    };

    const [exportWeekStart, setExportWeekStart] = useState(() => {
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(today.setDate(diff)).toISOString().split('T')[0];
    });

    const { projects, setProjects, workers, setWorkers, customers, setCustomers, hourlyWage, setHourlyWage, isGeminiEnabled, setIsGeminiEnabled, isLoading, setIsLoading, fetchAllData, fetchProjectDetails } = useSupabaseData(showToast);

    const workerOps = useWorkers({ workers, setWorkers, showToast });
    const projectOps = useProjects({ projects, setProjects, activeProjectId, setActiveProjectId, showToast, workers });
    const dashboardStats = useDashboardStats({ projects, activeProject: projectOps.activeProject, hourlyWage });

    const groupedProjects = useMemo(() => {
        const groups = { [PROJECT_STATUS.ESTIMATE]: [], [PROJECT_STATUS.SCHEDULED]: [], [PROJECT_STATUS.IN_PROGRESS]: [], [PROJECT_STATUS.COMPLETED]: [] };
        (dashboardStats.displayProjects || []).forEach(p => {
            const st = p.status || PROJECT_STATUS.ESTIMATE;
            if (groups[st]) groups[st].push(p);
        });
        return groups;
    }, [dashboardStats.displayProjects]);


    useEffect(() => {
        fetchAllData(null, setActiveProjectId);
    }, [fetchAllData]);

    useEffect(() => {
        if (activeProjectId) {
            localStorage.setItem('cost-app-activeProjectId', JSON.stringify(activeProjectId));
        }
    }, [activeProjectId]);

    // アクティブプロジェクトの変更を監視し、詳細データが空であれば遅延ロードする
    useEffect(() => {
        if (activeProjectId) {
            const activeProj = projects.find(p => p.id === activeProjectId);
            if (activeProj && activeProj._isLoaded === false) {
                fetchProjectDetails(activeProjectId);
            }
        }
    }, [activeProjectId, projects, fetchProjectDetails]);

    // --- Excelインポート ---
    const fileInputRef = useRef(null);

    const handleExcelImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const parseRes = await parseExcelForImport(file, hourlyWage);
            const newMasterData = parseRes.masterData;

            if (newMasterData.length > 0) {
                const finalSiteName = parseRes.projectName || file.name.replace(/\.[^/.]+$/, "");
                const duplicateProject = projects.find(p => p.siteName === finalSiteName);

                setImportModalInfo({
                    type: duplicateProject ? 'duplicate' : 'normal',
                    data: newMasterData,
                    count: newMasterData.length,
                    fileName: finalSiteName,
                    customerName: parseRes.customerName,
                    duplicateId: duplicateProject?.id,
                    aiOptimized: false,
                    canOptimize: isGeminiEnabled,
                    isEmpty: !duplicateProject && !(projectOps.activeProject.masterData && projectOps.activeProject.masterData.length > 0)
                });

                if (duplicateProject) setAliasName(`${finalSiteName} (コピー)`);

            } else {
                showToast('取り込めるデータが見つかりませんでした。', 'error');
            }
        } catch (error) {
            console.error('Excelパースエラー:', error);
            showToast('エラーが発生しました。', 'error');
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleOptimizeRequest = async () => {
        if (!isGeminiEnabled || !importModalInfo) return;
        setIsLoading(true);
        showToast("AIが項目を最適化しています...", "success");
        try {
            const processedData = await optimizeItemsWithGemini(importModalInfo.data);
            setImportModalInfo({ ...importModalInfo, data: processedData, aiOptimized: true });
        } catch (error) {
            console.error('AI Optimize Error:', error);
            let userMessage = error.message;
            if (userMessage.includes('503') || userMessage.toLowerCase().includes('high demand') || userMessage.toLowerCase().includes('overloaded')) {
                userMessage = "現在AIサーバー(Google)が混雑しており利用できません。時間をおいて再度お試しいただくか、今回はAIを使わずにそのままインポート処理を進めてください。";
            } else if (userMessage.includes('404')) {
                userMessage = "AIモデルが見つかりません。設定されたモデルが廃止されたか一時的に利用できない可能性があります。";
            }
            showToast(`【エラー】${userMessage}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleImportChoice = async (choice, directParams = null) => {
        const info = directParams || importModalInfo;
        if (!info) return;
        setIsLoading(true);

        try {
            let targetProjectId = null;
            let siteNameToUse = info.fileName || info.finalSiteName || 'エクセル取込現場';
            const nextOrder = projects.length > 0 ? Math.max(...projects.map(p => p.order || 0)) + 1 : 0;

            // 顧客の登録・紐付け処理
            let customerId = null;
            if (info.customerName) {
                const { data: existingCustomer } = await supabase.from('Customers').select('id').eq('name', info.customerName).maybeSingle();
                if (existingCustomer) {
                    customerId = existingCustomer.id;
                } else {
                    const { data: newCustomer, error: insertError } = await supabase.from('Customers').insert([{ name: info.customerName }]).select();
                    if (!insertError && newCustomer && newCustomer.length > 0) {
                        customerId = newCustomer[0].id;
                    }
                }
            }

            if (choice === 'create_new') {
                const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: nextOrder, status: PROJECT_STATUS.ESTIMATE, customerId }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'create_alias') {
                const { data, error } = await supabase.from('Projects').insert([{ name: aliasName || 'エクセル取込現場', order: nextOrder, status: PROJECT_STATUS.ESTIMATE, customerId }]).select();
                if (error) throw error;
                targetProjectId = data[0].id;
            } else if (choice === 'overwrite' || choice === 'overwrite_empty') {
                targetProjectId = directParams ? directParams.projId : activeProjectId;
                if (!targetProjectId) {
                    const { data, error } = await supabase.from('Projects').insert([{ name: siteNameToUse, order: nextOrder, status: PROJECT_STATUS.ESTIMATE, customerId }]).select();
                    if (error) throw error;
                    targetProjectId = data[0].id;
                } else {
                    await supabase.from('ProjectTasks').delete().eq('projectId', targetProjectId);
                    if (choice === 'overwrite_empty' || siteNameToUse !== "エクセル取込現場") {
                        await supabase.from('Projects').update({ name: siteNameToUse, customerId }).eq('id', targetProjectId);
                    } else if (customerId) {
                        await supabase.from('Projects').update({ customerId }).eq('id', targetProjectId);
                    }
                }
            } else if (choice === 'overwrite_duplicate') {
                targetProjectId = info.duplicateId;
                await supabase.from('Projects').update({ customerId }).eq('id', targetProjectId);
                await supabase.from('ProjectTasks').delete().eq('projectId', targetProjectId);
            }

            // info.dataから isExcluded !== true のものだけを抽出し、taskプロパティに直して保存
            const validData = info.data.filter(m => !m.isExcluded);

            // タスクの挿入
            const tasksToInsert = validData.map((m, idx) => ({
                projectId: targetProjectId,
                name: m.task,
                target_hours: m.target,
                estimated_amount: m.estimatedAmount || 0,
                order: idx + 1,
                progress_percentage: 0
            }));

            if (tasksToInsert.length > 0) {
                await supabase.from('ProjectTasks').insert(tasksToInsert);
            }

            // DBから最新を再フェッチし、インポートした現場をアクティブにする
            await fetchAllData(targetProjectId, setActiveProjectId);

        } catch (e) {
            console.error(e);
            showToast("DB保存中にエラーが発生しました", 'error');
        } finally {
            setIsLoading(false);
            setImportModalInfo(null);
            setAliasName("");
        }
    };
    const handleExportToExcel = () => {
        if (!projectOps.activeProject || !projectOps.activeProject.masterData || projectOps.activeProject.masterData.length === 0) {
            showToast('出力するデータがありません。', 'error');
            return;
        }
        exportToExcel(projectOps.activeProject, dashboardStats.summaryData);
    };

    const exportWorkerReport = async () => {
        const modalVal = workerOps.exportModalWorker;
        if (!modalVal || !exportWeekStart) return;
        const workerNames = Array.isArray(modalVal) ? modalVal : [modalVal];
        setIsLoading(true);

        try {
            const startDate = new Date(exportWeekStart);
            const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                return d.toISOString().split('T')[0];
            });
            const weekPrefix = exportWeekStart.replace(/-/g, '').slice(0, 8);

            const workersDataList = [];

            for (const workerName of workerNames) {
                const { data: recordsData } = await supabase.from('TaskRecords')
                    .select('*, ProjectTasks(name, projectId)')
                    .eq('worker_name', workerName)
                    .gte('date', days[0])
                    .lte('date', days[6]);

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

                // 残業承認状況（未承認の判定に使用）
                let overtimeApprovals = [];
                try {
                    overtimeApprovals = await fetchApprovalsForReport(workerName, days[0], days[6]);
                } catch (e) { console.error('Failed to fetch overtime approvals:', e); }

                // 作業手当承認状況（未承認の判定に使用）
                let workAllowanceApprovals = [];
                try {
                    workAllowanceApprovals = await fetchWorkAllowanceApprovalsForReport(workerName, days[0], days[6]);
                } catch (e) { console.error('Failed to fetch work allowance approvals:', e); }

                workersDataList.push({
                    workerName,
                    days,
                    recordsData,
                    projects,
                    subcontractorsData,
                    overtimeApprovals,
                    workAllowanceApprovals
                });
            }

            if (workersDataList.length > 0) {
                generateMultipleWorkersReportExcel(workersDataList, weekPrefix);
            }

            workerOps.setExportModalWorker(null);
            if (workerNames.length > 1) {
                showToast(`${workerNames.length}名分の日報を1つのExcelにまとめて出力しました`, 'success');
            } else {
                showToast('日報Excelを出力しました', 'success');
            }

        } catch (e) {
            console.error(e);
            showToast("出力処理中にエラーが発生しました。", 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // PDF出力
    const exportWorkerReportPDF = async () => {
        const modalVal = workerOps.exportModalWorker;
        if (!modalVal || !exportWeekStart) return;
        const workerNames = Array.isArray(modalVal) ? modalVal : [modalVal];
        setIsLoading(true);
        try {
            const startDate = new Date(exportWeekStart);
            const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                return d.toISOString().split('T')[0];
            });
            const weekPrefix = exportWeekStart.replace(/-/g, '').slice(0, 8);

            // 会社休日の取得
            const { data: holidayData } = await supabase.from('CompanyHolidays').select('date');

            const workersDataList = [];

            for (const workerName of workerNames) {
                const { data: recordsData } = await supabase.from('TaskRecords')
                    .select('*, ProjectTasks(name, projectId)')
                    .eq('worker_name', workerName)
                    .gte('date', days[0])
                    .lte('date', days[6]);

                const foremanProjects = projects.filter(p => p.foreman_worker_id === workers.find(w => w.name === workerName)?.id);
                let subcontractorsData = [];
                if (foremanProjects.length > 0) {
                    const { data: subData } = await supabase.from('SubcontractorRecords')
                        .select('*')
                        .in('project_id', foremanProjects.map(p => p.id))
                        .gte('date', days[0])
                        .lte('date', days[6]);
                    if (subData) subcontractorsData = subData;
                }

                // 残業承認状況（未承認の判定に使用）
                let overtimeApprovals = [];
                try {
                    overtimeApprovals = await fetchApprovalsForReport(workerName, days[0], days[6]);
                } catch (e) { console.error('Failed to fetch overtime approvals:', e); }

                // 作業手当承認状況（未承認の判定に使用）
                let workAllowanceApprovals = [];
                try {
                    workAllowanceApprovals = await fetchWorkAllowanceApprovalsForReport(workerName, days[0], days[6]);
                } catch (e) { console.error('Failed to fetch work allowance approvals:', e); }

                workersDataList.push({
                    workerName,
                    days,
                    recordsData,
                    projects,
                    subcontractorsData,
                    overtimeApprovals,
                    workAllowanceApprovals
                });
            }

            if (workersDataList.length > 0) {
                generateMultipleWorkersReportPDF(workersDataList, weekPrefix, holidayData || []);
            }

            workerOps.setExportModalWorker(null);
            if (workerNames.length > 1) {
                showToast(`${workerNames.length}名分の日報をまとめてPDF出力しました`, 'success');
            } else {
                showToast('日報PDFを出力しました', 'success');
            }
        } catch (e) {
            console.error(e);
            showToast(e?.message || 'PDF出力中にエラーが発生しました。', 'error');
        } finally {
            setIsLoading(false);
        }
    };


    if (isLoading && projects.length === 0) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
            <div className={`${activeTab === 'assignment' || activeTab === 'dashboard' ? 'max-w-none px-4 xl:px-8' : 'max-w-6xl'} mx-auto`}>
                <header className="mb-6">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2 cursor-pointer hover:opacity-80 transition" onClick={() => setActiveTab('dashboard')}>
                                <BarChart3 className="text-blue-600" /> 工事管理システム
                            </h1>
                            <nav className="bg-white p-2 rounded-lg shadow-sm border flex gap-1 overflow-x-auto">
                                {[
                                    { key: 'dashboard', label: 'ホーム', Icon: Home },
                                    { key: 'assignment', label: '配置表', Icon: Calendar },
                                    { key: 'daily_report', label: '日報', Icon: FileText },
                                    { key: 'estimate', label: '見積', Icon: Clipboard },
                                    { key: 'workers', label: '作業員', Icon: Users },
                                    { key: 'purchase_ledger', label: '材料', Icon: Table },
                                    { key: 'settings', label: '設定', Icon: Settings },
                                ].map(({ key, label, Icon }) => (
                                    <button key={key} onClick={() => setActiveTab(key)} className={`px-4 py-2 rounded-md transition font-bold whitespace-nowrap flex items-center gap-1.5 ${activeTab === key ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
                                        <Icon size={16} />
                                        {label}
                                    </button>
                                ))}
                            </nav>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-2">
                            {activeTab === 'master' && (
                                <div className="flex items-center gap-1">
                                    <button onClick={projectOps.addNewProject} title="新しい現場を追加" className="px-3 py-2 text-slate-500 flex items-center gap-2 hover:text-blue-600 hover:bg-white rounded-lg transition shadow-sm border border-transparent hover:border-blue-200 text-sm font-bold">
                                        <PlusCircle size={18} />
                                        新しい現場を追加
                                    </button>
                                    <div className="w-px h-6 bg-slate-200 mx-1"></div>
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
                                        className="cursor-pointer px-3 py-2 text-slate-500 flex items-center gap-2 hover:text-blue-600 hover:bg-white rounded-lg transition shadow-sm border border-transparent hover:border-blue-200 text-sm font-bold"
                                    >
                                        {isLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <Upload size={18} />}
                                        Excelからインポート
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <main className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden min-h-[500px]">
                    {isLoading && <div className="h-1 bg-blue-100 overflow-hidden"><div className="w-1/2 h-full bg-blue-500 animate-pulse"></div></div>}

                    {activeTab === 'dashboard' && (
                        <div className={`p-6 bg-slate-100 min-h-full ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                            {/* サブホーム切り替えタブ */}
                            <div className="flex gap-2 mb-6">
                                {[
                                    { key: 'all', label: '工事一覧' },
                                    { key: 'estimate', label: '見積' },
                                    { key: 'completed', label: '完了' }
                                ].map(({ key, label }) => (
                                    <button
                                        key={key}
                                        onClick={() => setDashboardSubTab(key)}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDragEnter={() => setIsDragOverTab(prev => ({ ...prev, [key]: true }))}
                                        onDragLeave={() => setIsDragOverTab(prev => ({ ...prev, [key]: false }))}
                                        onDrop={() => handleTabDrop(key)}
                                        className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all shadow-sm border-2 duration-200
                                            ${dashboardSubTab === key 
                                                ? 'bg-blue-600 text-white border-blue-600 scale-[1.02] shadow-md' 
                                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                                            }
                                            ${isDragOverTab[key] 
                                                ? 'bg-amber-100 border-amber-400 text-amber-800 animate-pulse scale-105 border-dashed border-2 shadow-lg' 
                                                : ''
                                            }
                                        `}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                    <Home className="text-blue-600" /> 
                                    {dashboardSubTab === 'all' && '登録済み工事一覧'}
                                    {dashboardSubTab === 'estimate' && '見積サブホーム（非表示工事）'}
                                    {dashboardSubTab === 'completed' && '完了サブホーム（非表示工事）'}
                                </h2>

                                {projects.length > 0 && (
                                    <div className="relative group w-full md:w-64">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-blue-500 transition-colors" />
                                        <input
                                            type="text"
                                            placeholder="工事名で検索..."
                                            className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-blue-400 focus:ring-4 focus:ring-blue-50 outline-none w-full font-bold text-slate-700 transition-all shadow-sm"
                                            value={dashboardStats.searchQuery}
                                            onChange={(e) => dashboardStats.setSearchQuery(e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>

                            {projects.length === 0 ? (
                                <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                                    <FolderGit2 className="mx-auto w-16 h-16 text-slate-300 mb-4" />
                                    <p className="text-slate-500 font-bold mb-4">まだ現場が登録されていません</p>
                                    <button onClick={projectOps.addNewProject} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold shadow-md hover:bg-blue-700 transition flex items-center gap-2 mx-auto">
                                        <PlusCircle size={20} /> 新しい現場を作成
                                    </button>
                                </div>
                            ) : dashboardStats.displayProjects.length === 0 ? (
                                <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 font-bold">該当する条件の現場がありません。</div>
                            ) : (
                                <div className="flex flex-row gap-4 overflow-x-auto pb-4 items-start">
                                    {PROJECT_STATUS_LIST.filter(status => {
                                        if (dashboardSubTab === 'estimate') return status === PROJECT_STATUS.ESTIMATE;
                                        if (dashboardSubTab === 'completed') return status === PROJECT_STATUS.COMPLETED;
                                        return true;
                                    }).map(status => {
                                        let columnProjects = [];
                                        const rawProjects = groupedProjects[status] || [];
                                        if (dashboardSubTab === 'all') {
                                            if (status === PROJECT_STATUS.ESTIMATE || status === PROJECT_STATUS.COMPLETED) {
                                                columnProjects = rawProjects.filter(p => p.show_on_home !== false);
                                            } else {
                                                columnProjects = rawProjects;
                                            }
                                        } else if (dashboardSubTab === 'estimate') {
                                            columnProjects = rawProjects.filter(p => p.show_on_home === false);
                                        } else if (dashboardSubTab === 'completed') {
                                            columnProjects = rawProjects.filter(p => p.show_on_home === false);
                                        }

                                        const ITEMS_PER_PAGE = 10;
                                        const totalPages = Math.max(1, Math.ceil(columnProjects.length / ITEMS_PER_PAGE));
                                        const currentPage = dashboardPages[status] || 1;
                                        
                                        const validPage = Math.min(Math.max(1, currentPage), totalPages);
                                        const startIndex = (validPage - 1) * ITEMS_PER_PAGE;
                                        const visibleProjects = columnProjects.slice(startIndex, startIndex + ITEMS_PER_PAGE);

                                        const handlePageChange = (newPage) => {
                                            setDashboardPages(prev => ({ ...prev, [status]: newPage }));
                                        };

                                        return (
                                            <div 
                                                key={status} 
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={(e) => handleColumnDrop(e, status)}
                                                className="flex flex-col flex-1 min-w-[280px] sm:min-w-[320px] w-full bg-slate-200/50 rounded-xl p-3"
                                            >
                                                <div className="flex items-center justify-between mb-3 px-1">
                                                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                                        <span className={`w-3 h-3 rounded-full ${PROJECT_STATUS_COLOR[status] || 'bg-slate-400'}`}></span>
                                                        {status}
                                                    </h3>
                                                    <span className="text-xs font-bold text-slate-500 bg-white px-2 py-0.5 rounded-full shadow-sm">{columnProjects.length}件</span>
                                                </div>

                                                <div 
                                                    onDragOver={(e) => e.preventDefault()}
                                                    onDrop={(e) => handleColumnDrop(e, status)}
                                                    className="flex flex-col gap-3 flex-1"
                                                >
                                                    {visibleProjects.map(proj => (
                                                        <div
                                                            key={proj.id}
                                                            onDragOver={(e) => handleDragOverCard(e, proj.id)}
                                                            onDragEnd={handleDragEnd}
                                                            onDrop={(e) => handleCardDrop(e, status, proj.id)}
                                                            className={`bg-white rounded-lg border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-blue-400 transition-all overflow-hidden flex flex-col group p-4
                                                                ${draggedProjectId === proj.id ? 'opacity-40 border-dashed border-blue-300' : 'border-slate-200'}
                                                                ${dragOverProjectId === proj.id && dragOverPosition === 'before' ? 'shadow-[inset_0_4px_0_0_#3b82f6]' : ''}
                                                                ${dragOverProjectId === proj.id && dragOverPosition === 'after' ? 'shadow-[inset_0_-4px_0_0_#3b82f6]' : ''}
                                                            `}
                                                        >
                                                            {/* 操作バー：ドラッグハンドル（PC）＋ステータス変更（タッチ対応） */}
                                                            <div className="flex items-center justify-between mb-2 -mt-1">
                                                                <span
                                                                    draggable="true"
                                                                    onDragStart={(e) => handleDragStart(e, proj.id)}
                                                                    onDragEnd={handleDragEnd}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    role="button"
                                                                    aria-label="ドラッグして並び替え・ステータス変更"
                                                                    title="ドラッグして並び替え・ステータス変更"
                                                                    className="hidden sm:inline-flex items-center text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing p-1 -ml-1 rounded"
                                                                >
                                                                    <GripVertical size={16} />
                                                                </span>
                                                                <select
                                                                    value={status}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    onChange={(e) => { e.stopPropagation(); handleStatusSelect(proj.id, e.target.value); }}
                                                                    aria-label="ステータスを変更"
                                                                    title="ステータスを変更"
                                                                    className="ml-auto text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-0.5 outline-none focus:border-blue-400 cursor-pointer"
                                                                >
                                                                    {PROJECT_STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                                                                </select>
                                                            </div>

                                                            {/* 本文：クリックで詳細へ */}
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setActiveProjectId(proj.id);
                                                                    setActiveTab('master');
                                                                }}
                                                                className="text-left cursor-pointer flex flex-col flex-1 w-full"
                                                            >
                                                                <div className="mb-3">
                                                                    <h4 className="font-bold text-slate-800 line-clamp-2 leading-tight group-hover:text-blue-700 transition-colors text-sm">
                                                                        {proj.siteName}
                                                                    </h4>
                                                                    <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                                                                        <User size={12} className="text-slate-400" />
                                                                        {proj.foreman_worker_id ? (workers.find(w => w.id === proj.foreman_worker_id)?.name || '未設定') : '職長未設定'}
                                                                    </div>
                                                                </div>

                                                                <div className="mt-auto pt-2 border-t border-slate-100 w-full">
                                                                    <div className="flex justify-between items-end mb-1">
                                                                        <span className="text-xs font-bold text-slate-500">進捗 {proj.overallProgress}%</span>
                                                                        <span className={`text-xs font-bold ${proj.predictedProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                            {proj.predictedProfitLoss >= 0 ? '+' : ''}¥{Math.abs(Math.round(proj.predictedProfitLoss)).toLocaleString()}
                                                                        </span>
                                                                    </div>
                                                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                                        <div className={`h-full rounded-full ${PROJECT_STATUS_COLOR[status] || 'bg-slate-400'}`} style={{ width: `${Math.min(100, Math.max(0, proj.overallProgress))}%` }}></div>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {visibleProjects.length === 0 && (
                                                        <div className="text-center py-8 text-xs text-slate-400 font-bold border-2 border-dashed border-slate-300 rounded-lg">
                                                            なし
                                                        </div>
                                                    )}
                                                </div>

                                                {totalPages > 1 && (
                                                    <div className="flex items-center justify-between mt-4 px-2 text-xs font-bold text-slate-500 select-none bg-white py-1.5 rounded-lg shadow-sm border border-slate-100">
                                                        <button 
                                                            disabled={validPage <= 1}
                                                            onClick={(e) => { e.stopPropagation(); handlePageChange(validPage - 1); }}
                                                            className="hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-500 transition px-2 py-1 flex items-center gap-1"
                                                        >
                                                            &lt; 前
                                                        </button>
                                                        <span className="tracking-widest">{validPage}<span className="text-[10px] text-slate-300 mx-1">/</span>{totalPages}</span>
                                                        <button 
                                                            disabled={validPage >= totalPages}
                                                            onClick={(e) => { e.stopPropagation(); handlePageChange(validPage + 1); }}
                                                            className="hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-500 transition px-2 py-1 flex items-center gap-1"
                                                        >
                                                            次 &gt;
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'master' && (
                        <MasterTab
                            activeProject={projectOps.activeProject}
                            isLoading={isLoading}
                            handleExcelImport={handleExcelImport}
                            fileInputRef={fileInputRef}
                            removeProject={projectOps.removeProject}
                            updateLayer={projectOps.updateLayer}
                            handleSiteNameBlur={projectOps.handleSiteNameBlur}
                            handleProjectStatusChange={projectOps.handleProjectStatusChange}
                            handleForemanChange={projectOps.handleForemanChange}
                            handleProjectDateChange={projectOps.handleProjectDateChange}
                            workers={workers}
                            customers={customers}
                            updateMasterItemLocal={projectOps.updateMasterItemLocal}
                            saveMasterItemDB={projectOps.saveMasterItemDB}
                            reorderMasterItems={projectOps.reorderMasterItems}
                            removeMasterItem={projectOps.removeMasterItem}
                            addMasterItem={projectOps.addMasterItem}
                            HOURLY_WAGE={hourlyWage}
                            // Props for DashboardTab
                            summaryData={dashboardStats.summaryData}
                            saveProgressDB={projectOps.saveProgressDB}
                            handleExportToExcel={() => exportToExcel(projectOps.activeProject, dashboardStats.summaryData)}
                            // Props for InputTab
                            addRecord={projectOps.addRecord}
                            updateRecordField={projectOps.updateRecordField}
                            removeRecord={projectOps.removeRecord}
                            focusedWorkerRow={workerOps.focusedWorkerRow}
                            setFocusedWorkerRow={workerOps.setFocusedWorkerRow}
                            addSubcontractorRecord={projectOps.addSubcontractorRecord}
                            updateSubcontractorRecordField={projectOps.updateSubcontractorRecordField}
                            removeSubcontractorRecord={projectOps.removeSubcontractorRecord}
                            // Deletion Modal Props
                            isDeleteModalOpen={projectOps.isDeleteModalOpen}
                            setIsDeleteModalOpen={projectOps.setIsDeleteModalOpen}
                            confirmRemoveProject={projectOps.confirmRemoveProject}
                        />
                    )}

                    {activeTab === 'daily_report' && (
                        <DailyReportTab
                            isLoading={isLoading}
                            workers={workers}
                            workerSummaryData={dashboardStats.workerSummaryData}
                            setExportModalWorker={workerOps.setExportModalWorker}
                        />
                    )}

                    {activeTab === 'workers' && (
                        <WorkersTab
                            isLoading={isLoading}
                            workers={workers}
                            addWorker={workerOps.addWorker}
                            handleWorkerReorder={workerOps.handleWorkerReorder}
                            openEditWorkerModal={workerOps.openEditWorkerModal}
                            removeWorker={workerOps.removeWorker}
                        />
                    )}

                    {activeTab === 'settings' && (
                        <SystemSettingsTab
                            hourlyWage={hourlyWage}
                            setHourlyWage={setHourlyWage}
                            isGeminiEnabled={isGeminiEnabled}
                            setIsGeminiEnabled={setIsGeminiEnabled}
                            isLoading={isLoading}
                            setIsLoading={setIsLoading}
                            workers={workers}
                            fetchAllData={fetchAllData}
                        />
                    )}

                    {activeTab === 'purchase_ledger' && (
                        <PurchaseLedgerTab />
                    )}

                    {activeTab === 'assignment' && (
                        <AssignmentChartTab
                            projects={projects}
                            workers={workers}
                            allProjectsSummary={dashboardStats.allProjectsSummary || []}
                            setActiveTab={setActiveTab}
                            setActiveProjectId={setActiveProjectId}
                            setProjects={setProjects}
                            customers={customers}
                        />
                    )}

                    {activeTab === 'estimate' && (
                        estimateEditId === undefined ? (
                            // 一覧画面
                            <EstimateList
                                onEdit={(id) => setEstimateEditId(id === null ? null : id)}
                            />
                        ) : (
                            // 新規作成 or 編集画面
                            <EstimateForm
                                estimateId={estimateEditId}  // null=新規, number=編集
                                onBack={() => setEstimateEditId(undefined)}
                                onSaved={() => setEstimateEditId(undefined)}
                            />
                        )
                    )}
                </main>

                {/* 作業員別日報出力モーダル */}
                <ExportReportModal
                    isOpen={!!workerOps.exportModalWorker}
                    workerName={typeof workerOps.exportModalWorker === 'string' ? workerOps.exportModalWorker : null}
                    workerNames={Array.isArray(workerOps.exportModalWorker) ? workerOps.exportModalWorker : null}
                    exportWeekStart={exportWeekStart}
                    setExportWeekStart={setExportWeekStart}
                    onClose={() => workerOps.setExportModalWorker(null)}
                    onExport={exportWorkerReport}
                    onExportPDF={exportWorkerReportPDF}
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
                    onOptimize={handleOptimizeRequest}
                />

                {/* 作業員詳細編集モーダル */}
                <WorkerEditModal
                    isOpen={workerOps.isWorkerModalOpen}
                    editingWorker={workerOps.editingWorker}
                    setEditingWorker={workerOps.setEditingWorker}
                    onClose={() => {
                        workerOps.setIsWorkerModalOpen(false);
                        workerOps.setEditingWorker(null);
                    }}
                    onSave={workerOps.saveWorker}
                />
            </div>
        </div>
    );
};

export default App;

