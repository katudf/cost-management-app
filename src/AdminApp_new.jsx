import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSupabaseData } from './hooks/useSupabaseData';
import { useProjects } from './hooks/useProjects';
import { useWorkers } from './hooks/useWorkers';
import { useDashboardStats } from './hooks/useDashboardStats';

import { useToast } from './components/Toast';
import { Table, Clipboard, BarChart3, Settings, Home, TrendingDown, TrendingUp, DollarSign, FolderGit2, PlusCircle, Loader2, User, Users, FileText, Calendar } from 'lucide-react';
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
import PurchaseLedgerTab from './components/tabs/PurchaseLedgerTab';
import AssignmentChartTab from './components/tabs/AssignmentChartTab';

const App = () => {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState('dashboard');
    const [importModalInfo, setImportModalInfo] = useState(null);
    const [aliasName, setAliasName] = useState("");


    const [activeProjectId, setActiveProjectId] = useState(null);
    const [exportWeekStart, setExportWeekStart] = useState(() => {
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(today.setDate(diff)).toISOString().split('T')[0];
    });

    const { projects, setProjects, workers, setWorkers, hourlyWage, setHourlyWage, isLoading, setIsLoading, fetchAllData } = useSupabaseData(showToast);

    const workerOps = useWorkers({ workers, setWorkers, showToast });
    const projectOps = useProjects({ projects, setProjects, activeProjectId, setActiveProjectId, showToast, workers });
    const dashboardStats = useDashboardStats({ projects, activeProject: projectOps.activeProject, hourlyWage });

    useEffect(() => {
        fetchAllData(null, setActiveProjectId);
    }, [fetchAllData]);

    useEffect(() => {
        if (activeProjectId) {
            localStorage.setItem('cost-app-activeProjectId', JSON.stringify(activeProjectId));
        }
    }, [activeProjectId]);

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
                    showToast('取り込めるデータが見つかりませんでした。', 'error');
                }
            } catch (error) {
                console.error('Excelパースエラー:', error);
                showToast('エラーが発生しました。', 'error');
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
            showToast("DB保存中にエラーが発生しました", 'error');
        } finally {
            setIsLoading(false);
            setImportModalInfo(null);
            setAliasName("");
        }
    };
    const handleExportToExcel = () => {
        if (!activeProject || !activeProject.masterData || activeProject.masterData.length === 0) {
            showToast('出力するデータがありません。', 'error');
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
            showToast("出力処理中にエラーが発生しました。", 'error');
        } finally {
            setIsLoading(false);
        }
    };

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
                                <BarChart3 className="text-blue-600" /> 工事管理システム
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
                                {activeTab === 'master' && (
                                    <button onClick={addNewProject} title="新しい現場を追加" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition shadow-sm border border-transparent hover:border-blue-200">
                                        <PlusCircle size={20} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <nav className="bg-white p-2 rounded-lg shadow-sm border flex gap-1 mt-2 md:mt-0 overflow-x-auto">
                            {[
                                { key: 'dashboard', label: 'ホーム', Icon: Home },
                                { key: 'summary', label: '管理シート', Icon: Table },
                                { key: 'input', label: '実績入力', Icon: Clipboard },
                                { key: 'master', label: '工事設定', Icon: Settings },
                                { key: 'workers', label: '作業員', Icon: Users },
                                { key: 'assignment', label: '配置表', Icon: Calendar },
                                { key: 'settings', label: 'システム設定', Icon: Settings },
                                { key: 'purchase_ledger', label: '材料', Icon: FileText },
                            ].map(({ key, label, Icon }) => (
                                <button key={key} onClick={() => setActiveTab(key)} className={`px-4 py-2 rounded-md transition font-bold whitespace-nowrap flex items-center gap-1.5 ${activeTab === key ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
                                    <Icon size={16} />
                                    {label}
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

                            {/* 全体サマリー統計 */}
                            {projects.length > 0 && (() => {
                                const activeProjects = allProjectsSummary.filter(p => (p.status || '予定') === '施工中');
                                const plannedCount = allProjectsSummary.filter(p => (p.status || '予定') === '予定').length;
                                const completedCount = allProjectsSummary.filter(p => (p.status || '予定') === '完了').length;
                                const totalProfit = activeProjects.reduce((sum, p) => sum + (p.predictedProfitLoss || 0), 0);
                                const totalActual = activeProjects.reduce((sum, p) => sum + (p.totalActual || 0), 0);
                                const totalTarget = activeProjects.reduce((sum, p) => sum + (p.totalTarget || 0), 0);
                                return (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                                                <FolderGit2 className="text-blue-600" size={24} />
                                            </div>
                                            <div>
                                                <div className="text-xs font-bold text-slate-400 mb-1">工事件数</div>
                                                <div className="flex items-center gap-3 text-sm font-bold">
                                                    <span className="text-green-600">施工中 {activeProjects.length}</span>
                                                    <span className="text-blue-500">予定 {plannedCount}</span>
                                                    <span className="text-slate-400">完了 {completedCount}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-xl ${totalProfit >= 0 ? 'bg-green-100' : 'bg-red-100'} flex items-center justify-center`}>
                                                <DollarSign className={totalProfit >= 0 ? 'text-green-600' : 'text-red-600'} size={24} />
                                            </div>
                                            <div>
                                                <div className="text-xs font-bold text-slate-400 mb-1">施工中の予測粗利合計</div>
                                                <div className={`text-xl font-black ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    ¥{Math.abs(Math.round(totalProfit)).toLocaleString()}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                                                <BarChart3 className="text-indigo-600" size={24} />
                                            </div>
                                            <div>
                                                <div className="text-xs font-bold text-slate-400 mb-1">施工中 総消化工数 / 目標</div>
                                                <div className="text-lg font-black text-slate-700">
                                                    {totalActual.toFixed(1)}<span className="text-xs font-normal text-slate-400">h</span>
                                                    <span className="text-slate-300 mx-1">/</span>
                                                    {totalTarget.toFixed(1)}<span className="text-xs font-normal text-slate-400">h</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

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
                            setActiveTab={setActiveTab}
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
                            handleProjectDateChange={handleProjectDateChange}
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
                            handleWorkerReorder={handleWorkerReorder}
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

