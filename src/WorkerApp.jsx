import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { Loader2, LogOut, HardHat, CheckCircle2, AlertCircle, Save, Trash2, PlusCircle, Clock, X, Wifi, WifiOff, FileText } from 'lucide-react';
import { useToast } from './components/Toast';
import { useConfirm } from './components/ConfirmProvider';
import { calculateWorkHours, calculateNinku, getSeasonConfig, formatTimeDisplay } from './utils/workTimeUtils';
import { PROJECT_STATUS } from './utils/constants';
import { syncOvertimeApproval, fetchPendingApprovals, approveOvertime, fetchApprovalReason, fetchApprovalsForReport } from './lib/overtimeApprovals';
import { syncWorkAllowanceApproval, fetchPendingWorkAllowanceApprovals, approveWorkAllowance, fetchWorkAllowanceApprovalsForReport } from './lib/workAllowanceApprovals';
import { fetchWithCache, getDraftQueue, upsertDraft, removeDraft } from './utils/offlineCache';
import { generateMultipleWorkersReportPDF } from './utils/pdfExportUtils';

// ローカルタイムゾーンで 'YYYY-MM-DD' を生成する（toISOString はUTC変換されるため日付がずれる）
const formatDateLocal = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const WorkerApp = () => {
    const { showToast } = useToast();
    const { confirm, prompt } = useConfirm();
    const [workers, setWorkers] = useState([]);
    const [loggedInWorker, setLoggedInWorker] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [projects, setProjects] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [tasks, setTasks] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isExportingPDF, setIsExportingPDF] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    const [subcontractors, setSubcontractors] = useState([]);
    const [deletedSubcontractorIds, setDeletedSubcontractorIds] = useState([]);

    const [hourlyWage, setHourlyWage] = useState(3500);
    const [allProjectRecords, setAllProjectRecords] = useState([]);
    const [allSubcontractorRecords, setAllSubcontractorRecords] = useState([]);
    const [workerDailyAllRecords, setWorkerDailyAllRecords] = useState([]);
    const [draftQueue, setDraftQueue] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [isSyncingQueue, setIsSyncingQueue] = useState(false);

    const [selectedDate, setSelectedDate] = useState(() => formatDateLocal(new Date()));

    // 残業理由（その現場・その日の残業に対する任意のメモ）
    const [overtimeReason, setOvertimeReason] = useState('');
    // 職長: 承認待ちの残業申請リスト
    const [pendingApprovals, setPendingApprovals] = useState([]);
    const [approvingId, setApprovingId] = useState(null);
    // 職長: 承認待ちの作業手当申請リスト
    const [pendingAllowanceApprovals, setPendingAllowanceApprovals] = useState([]);
    const [approvingAllowanceId, setApprovingAllowanceId] = useState(null);

    // Initial load
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                setDraftQueue(getDraftQueue());

                const savedWorkerStr = localStorage.getItem('cost-app-worker');
                if (savedWorkerStr) setLoggedInWorker(JSON.parse(savedWorkerStr));
                const savedProjectId = localStorage.getItem('cost-app-worker-project');
                if (savedProjectId) setSelectedProjectId(savedProjectId);

                const { data: wData } = await fetchWithCache('workers',
                    () => supabase.from('Workers').select('id, name, resignation_date').order('display_order', { ascending: true, nullsFirst: false })
                );
                if (wData) setWorkers(wData.filter(w => w.name && w.name.trim() !== '' && !w.resignation_date));

                const { data: pData } = await fetchWithCache('projects',
                    () => supabase.from('Projects').select('*').order('created_at', { ascending: true })
                );
                if (pData) setProjects(pData);

                const { data: settingsData } = await fetchWithCache('hourly_wage',
                    () => supabase.from('system_settings').select('hourly_wage').eq('id', 1).single()
                );
                if (settingsData && settingsData.hourly_wage) setHourlyWage(settingsData.hourly_wage);
            } catch (error) {
                console.error('Initialization error:', error);
            } finally {
                setIsLoading(false);
            }
        };
        init();

        const handleOnline = () => {
            setIsOnline(true);
            const queued = getDraftQueue();
            if (queued.length > 0) {
                showToast(`通信が回復しました。未送信のデータが${queued.length}件あります。内容を確認して送信してください。`, 'warning');
            }
        };
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Fetch worker daily records across ALL projects
    useEffect(() => {
        if (!loggedInWorker || !selectedDate) { setWorkerDailyAllRecords([]); return; }
        const fetch = async () => {
            try {
                const cacheKey = `worker-daily-records-${loggedInWorker.name}-${selectedDate}`;
                const { data } = await fetchWithCache(cacheKey,
                    () => supabase.from('TaskRecords').select('*').eq('worker_name', loggedInWorker.name).eq('date', selectedDate)
                );
                setWorkerDailyAllRecords(data || []);
            } catch (e) { console.error(e); }
        };
        fetch();
    }, [loggedInWorker, selectedDate]);

    // Load tasks when project is selected
    useEffect(() => {
        if (!selectedProjectId || !loggedInWorker) { setTasks([]); return; }

        const loadProjectDetails = async () => {
            setIsLoading(true);
            setSaveMessage('');
            try {
                const targetDate = selectedDate;
                const tasksCacheKey = `project-tasks-${selectedProjectId}`;
                let { data: tData, fromCache: tFromCache } = await fetchWithCache(tasksCacheKey,
                    () => supabase.from('ProjectTasks').select('*').eq('projectId', selectedProjectId).order('order', { ascending: true })
                );

                // 有給・社内業務などの特別な共通現場で作業項目が未登録の場合は自動生成する（オンライン時のみ）
                const project = projects.find(p => p.id === Number(selectedProjectId));
                const COMMON_PROJECT_NAMES = ["【会社】社内業務・雑務", "【会社】有給", "有給", "【有給】"];
                if (!tFromCache && project && COMMON_PROJECT_NAMES.includes(project.name) && (!tData || tData.length === 0)) {
                    let defaultTaskName = '社内業務・雑務';
                    if (project.name.includes('有給')) {
                        defaultTaskName = '有給休暇';
                    }
                    const newItem = {
                        projectId: Number(selectedProjectId),
                        name: defaultTaskName,
                        target_hours: 0,
                        estimated_amount: 0,
                        order: 1,
                        progress_percentage: 0
                    };
                    const { data: insertedData, error: insertError } = await supabase.from('ProjectTasks').insert([newItem]).select();
                    if (!insertError && insertedData && insertedData.length > 0) {
                        tData = insertedData;
                    }
                }

                const { data: rData } = await fetchWithCache(`task-records-${selectedProjectId}-${loggedInWorker.name}-${targetDate}`,
                    () => supabase.from('TaskRecords').select('*').eq('project_id', selectedProjectId).eq('worker_name', loggedInWorker.name).eq('date', targetDate)
                );
                const { data: sData } = await fetchWithCache(`subcontractor-records-${selectedProjectId}-${targetDate}`,
                    () => supabase.from('SubcontractorRecords').select('*').eq('project_id', selectedProjectId).eq('date', targetDate)
                );

                const mappedTasks = (tData || []).map(t => {
                    // 複数レコード対応: filter で全レコード取得
                    const todayRecords = (rData || []).filter(r => r.project_task_id === t.id);
                    const time_slots = todayRecords.length > 0
                        ? todayRecords.map(r => ({
                            slot_id: `existing-${r.id}`,
                            record_id: r.id,
                            start_time: formatTimeDisplay(r.start_time) || '',
                            end_time: formatTimeDisplay(r.end_time) || '',
                            is_overnight: (formatTimeDisplay(r.start_time) > formatTimeDisplay(r.end_time)) && formatTimeDisplay(r.end_time) !== ''
                        }))
                        : [{ slot_id: `new-${Date.now()}-${t.id}`, record_id: null, start_time: '', end_time: '', is_overnight: false }];

                    return {
                        id: t.id,
                        name: t.name || '',
                        target_hours: t.target_hours || 0,
                        progress_percentage: t.progress_percentage || 0,
                        time_slots,
                        deleted_record_ids: [],
                        today_note: todayRecords.length > 0 ? (todayRecords[0].note || '') : '',
                        work_allowance: todayRecords.length > 0 ? (todayRecords[0].work_allowance || false) : false,
                    };
                });

                setTasks(mappedTasks);
                setSubcontractors(sData || []);
                setDeletedSubcontractorIds([]);
                setHasUnsavedChanges(false);

                // 既存の残業理由を読み込む（その現場・その日・この作業員）
                try {
                    const reason = await fetchApprovalReason(selectedProjectId, loggedInWorker.name, selectedDate);
                    setOvertimeReason(reason);
                } catch (e) { setOvertimeReason(''); }

                if (project && project.foreman_worker_id === loggedInWorker.id) {
                    const { data: allRecords } = await fetchWithCache(`all-task-records-${selectedProjectId}`,
                        () => supabase.from('TaskRecords').select('*').eq('project_id', selectedProjectId)
                    );
                    setAllProjectRecords(allRecords || []);
                    const { data: allSubData } = await fetchWithCache(`all-subcontractor-records-${selectedProjectId}`,
                        () => supabase.from('SubcontractorRecords').select('*').eq('project_id', selectedProjectId)
                    );
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
    }, [selectedProjectId, loggedInWorker, selectedDate]);

    // 職長が担当する全現場の承認待ち残業を読み込む
    const loadPendingApprovals = useCallback(async () => {
        if (!loggedInWorker) { setPendingApprovals([]); return; }
        const foremanProjectIds = projects
            .filter(p => p.foreman_worker_id === loggedInWorker.id)
            .map(p => p.id);
        if (foremanProjectIds.length === 0) { setPendingApprovals([]); return; }
        try {
            const data = await fetchPendingApprovals(foremanProjectIds);
            setPendingApprovals(data);
        } catch (e) {
            console.error('Failed to load pending approvals:', e);
        }
    }, [loggedInWorker, projects]);

    useEffect(() => { loadPendingApprovals(); }, [loadPendingApprovals]);

    // 残業申請を承認する
    const handleApproveOvertime = async (id) => {
        setApprovingId(id);
        try {
            await approveOvertime(id, loggedInWorker.name);
            await loadPendingApprovals();
            showToast('残業を承認しました。', 'success');
        } catch (e) {
            console.error('Approve overtime error:', e);
            showToast('承認に失敗しました。', 'error');
        } finally {
            setApprovingId(null);
        }
    };

    // 職長が担当する全現場の承認待ち作業手当を読み込む
    const loadPendingAllowanceApprovals = useCallback(async () => {
        if (!loggedInWorker) { setPendingAllowanceApprovals([]); return; }
        const foremanProjectIds = projects
            .filter(p => p.foreman_worker_id === loggedInWorker.id)
            .map(p => p.id);
        if (foremanProjectIds.length === 0) { setPendingAllowanceApprovals([]); return; }
        try {
            const data = await fetchPendingWorkAllowanceApprovals(foremanProjectIds);
            setPendingAllowanceApprovals(data);
        } catch (e) {
            console.error('Failed to load pending work allowance approvals:', e);
        }
    }, [loggedInWorker, projects]);

    useEffect(() => { loadPendingAllowanceApprovals(); }, [loadPendingAllowanceApprovals]);

    // 作業手当申請を承認する
    const handleApproveWorkAllowance = async (id) => {
        setApprovingAllowanceId(id);
        try {
            await approveWorkAllowance(id, loggedInWorker.name);
            await loadPendingAllowanceApprovals();
            showToast('作業手当を承認しました。', 'success');
        } catch (e) {
            console.error('Approve work allowance error:', e);
            showToast('承認に失敗しました。', 'error');
        } finally {
            setApprovingAllowanceId(null);
        }
    };

    const handleLogin = (worker) => { setLoggedInWorker(worker); localStorage.setItem('cost-app-worker', JSON.stringify(worker)); };
    const handleLogout = async () => {
        const message = hasUnsavedChanges ? "未送信の入力データがあります。破棄してログアウトしますか？" : "ログアウトしますか？";
        const ok = await confirm({
            title: 'ログアウト',
            message,
            confirmText: 'ログアウト',
            variant: hasUnsavedChanges ? 'danger' : 'primary',
        });
        if (ok) {
            setHasUnsavedChanges(false);
            setLoggedInWorker(null); setSelectedProjectId(''); setTasks([]); setSubcontractors([]); setDeletedSubcontractorIds([]);
            localStorage.removeItem('cost-app-worker'); localStorage.removeItem('cost-app-worker-project');
        }
    };

    // 日報PDF出力（選択中の日付を含む月〜日の週で出力）
    const handleExportReportPDF = async () => {
        if (!loggedInWorker) return;
        setIsExportingPDF(true);
        try {
            const base = new Date(selectedDate);
            const dow = base.getDay(); // 0=日,1=月,...6=土
            const mondayOffset = dow === 0 ? -6 : 1 - dow;
            const monday = new Date(base);
            monday.setDate(monday.getDate() + mondayOffset);
            const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(monday);
                d.setDate(d.getDate() + i);
                return formatDateLocal(d);
            });
            const weekPrefix = days[0].replace(/-/g, '').slice(0, 8);

            const { data: holidayData } = await supabase.from('CompanyHolidays').select('date');

            const { data: recordsData } = await supabase.from('TaskRecords')
                .select('*, ProjectTasks(name, projectId)')
                .eq('worker_name', loggedInWorker.name)
                .gte('date', days[0])
                .lte('date', days[6]);

            const foremanProjects = projects.filter(p => p.foreman_worker_id === loggedInWorker.id);
            let subcontractorsData = [];
            if (foremanProjects.length > 0) {
                const { data: subData } = await supabase.from('SubcontractorRecords')
                    .select('*')
                    .in('project_id', foremanProjects.map(p => p.id))
                    .gte('date', days[0])
                    .lte('date', days[6]);
                if (subData) subcontractorsData = subData;
            }

            let overtimeApprovals = [];
            try {
                overtimeApprovals = await fetchApprovalsForReport(loggedInWorker.name, days[0], days[6]);
            } catch (e) { console.error('Failed to fetch overtime approvals:', e); }

            let workAllowanceApprovals = [];
            try {
                workAllowanceApprovals = await fetchWorkAllowanceApprovalsForReport(loggedInWorker.name, days[0], days[6]);
            } catch (e) { console.error('Failed to fetch work allowance approvals:', e); }

            generateMultipleWorkersReportPDF([{
                workerName: loggedInWorker.name,
                days,
                recordsData: recordsData || [],
                projects,
                subcontractorsData,
                overtimeApprovals,
                workAllowanceApprovals,
            }], weekPrefix, holidayData || [], false);
            showToast('日報プレビューを表示しました', 'success');
        } catch (e) {
            console.error(e);
            showToast(e?.message || 'PDF出力中にエラーが発生しました。', 'error');
        } finally {
            setIsExportingPDF(false);
        }
    };

    // ========== タスク操作 ==========
    const updateTaskField = (taskId, field, value) => {
        setHasUnsavedChanges(true);
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t));
    };

    const updateSlotField = (taskId, slotId, field, value) => {
        setHasUnsavedChanges(true);
        setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            return { ...t, time_slots: t.time_slots.map(s => s.slot_id === slotId ? { ...s, [field]: value } : s) };
        }));
    };

    const addTimeSlot = (taskId) => {
        setHasUnsavedChanges(true);
        setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            return { ...t, time_slots: [...t.time_slots, { slot_id: `new-${Date.now()}`, record_id: null, start_time: '', end_time: '', is_overnight: false }] };
        }));
    };

    const removeTimeSlot = (taskId, slotId, recordId) => {
        setHasUnsavedChanges(true);
        setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            const newSlots = t.time_slots.filter(s => s.slot_id !== slotId);
            const newDeleted = recordId ? [...t.deleted_record_ids, recordId] : t.deleted_record_ids;
            return {
                ...t,
                time_slots: newSlots.length > 0 ? newSlots : [{ slot_id: `new-${Date.now()}`, record_id: null, start_time: '', end_time: '', is_overnight: false }],
                deleted_record_ids: newDeleted,
            };
        }));
    };

    const addSubcontractor = () => { setHasUnsavedChanges(true); setSubcontractors(prev => [...prev, { id: 'temp-' + Date.now(), company_name: '', worker_count: 1 }]); };
    const updateSubcontractor = (id, field, value) => { setHasUnsavedChanges(true); setSubcontractors(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s)); };
    const removeSubcontractor = (id) => {
        setHasUnsavedChanges(true);
        if (!String(id).startsWith('temp-')) setDeletedSubcontractorIds(prev => [...prev, id]);
        setSubcontractors(prev => prev.filter(s => s.id !== id));
    };

    const handleAddNewTask = async () => {
        if (!selectedProjectId) return;
        
        const project = projects.find(p => p.id === Number(selectedProjectId));
        const isForeman = project && project.foreman_worker_id === loggedInWorker.id;
        if (!isForeman) {
            showToast("新しい作業項目の追加は職長のみ可能です。追加が必要な場合は職長に依頼してください。", 'error');
            return;
        }

        const taskName = await prompt({
            title: '作業項目の追加',
            message: '追加する作業項目の名称を入力してください。',
            placeholder: '例：屋根：高圧洗浄',
            confirmText: '追加する',
        });
        if (!taskName || taskName.trim() === '') return;
        setIsLoading(true);
        try {
            const newTaskOrder = tasks.length > 0 ? Math.max(...tasks.map(t => t.order || 0)) + 1 : 1;
            const { data, error } = await supabase.from('ProjectTasks').insert([{
                projectId: selectedProjectId, name: taskName.trim(), target_hours: 0, estimated_amount: 0, order: newTaskOrder, progress_percentage: 0
            }]).select();
            if (error) throw error;
            if (data && data[0]) {
                const ins = data[0];
                setTasks(prev => [...prev, {
                    id: ins.id, name: ins.name, target_hours: ins.target_hours, progress_percentage: ins.progress_percentage, order: ins.order,
                    time_slots: [{ slot_id: `new-${Date.now()}`, record_id: null, start_time: '', end_time: '', is_overnight: false }],
                    deleted_record_ids: [], today_note: '', work_allowance: false,
                }]);
                setHasUnsavedChanges(true);
            }
        } catch (e) { console.error(e); showToast('作業項目の追加に失敗しました。', 'error'); }
        finally { setIsLoading(false); }
    };

    // ========== 自動保存 (オートセーブ) ==========
    // 現場×日付 単位でキューに保存するため、他の現場/日付の未送信ドラフトは上書きされない
    useEffect(() => {
        if (hasUnsavedChanges && selectedProjectId && tasks.length > 0) {
            const timer = setTimeout(() => {
                const entry = upsertDraft({
                    selectedProjectId,
                    selectedDate,
                    tasks,
                    subcontractors,
                    deletedSubcontractorIds,
                    isAutoSaved: true,
                });
                setDraftQueue(prev => {
                    const key = `${entry.selectedProjectId}__${entry.selectedDate}`;
                    const others = prev.filter(d => `${d.selectedProjectId}__${d.selectedDate}` !== key);
                    return [...others, entry];
                });
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [tasks, subcontractors, deletedSubcontractorIds, hasUnsavedChanges, selectedProjectId, selectedDate]);

    // ========== 時間自動計算 (各タスク×各スロット) ==========
    const tasksWithCalculation = useMemo(() => {
        return tasks.map(t => {
            const slotCalcs = t.time_slots.map(slot => {
                if (slot.start_time && slot.end_time) {
                    const c = calculateWorkHours(slot.start_time, slot.end_time, selectedDate, slot.is_overnight);
                    return { ...c, has_input: true };
                }
                return { netWorkHours: 0, overtimeHours: 0, regularHours: 0, breakMinutes: 0, grossMinutes: 0, has_input: false };
            });
            const total_hours = slotCalcs.reduce((s, c) => s + c.netWorkHours, 0);
            const total_overtime = slotCalcs.reduce((s, c) => s + c.overtimeHours, 0);
            const total_break = slotCalcs.reduce((s, c) => s + c.breakMinutes, 0);
            const has_any_input = slotCalcs.some(c => c.has_input);
            return { ...t, slotCalcs, total_hours: Math.round(total_hours * 100) / 100, total_overtime: Math.round(total_overtime * 100) / 100, total_break, has_any_input };
        });
    }, [tasks, selectedDate]);

    // 時間帯ラップ（重複）チェック
    const timeOverlapWarnings = useMemo(() => {
        if (!selectedProjectId) return [];

        const toMinutes = (timeStr) => {
            if (!timeStr) return null;
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };

        const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

        const allIntervals = [];
        const warnings = [];
        const ap = projects.find(p => p.id === Number(selectedProjectId));

        workerDailyAllRecords
            .filter(r => String(r.project_id) !== String(selectedProjectId))
            .forEach(r => {
                const s = toMinutes(r.start_time);
                const e = toMinutes(r.end_time);
                if (s !== null && e !== null) {
                    const proj = projects.find(p => p.id === Number(r.project_id));
                    allIntervals.push({ projectId: r.project_id, projectName: proj?.name || '別現場', taskName: proj?.name || '別現場', start: s, end: e });
                }
            });

        tasks.forEach(t => {
            t.time_slots.forEach(slot => {
                const s = toMinutes(slot.start_time);
                let e = toMinutes(slot.end_time);
                if (s !== null && e !== null) {
                    if (slot.is_overnight) e += 1440;

                    if (s >= e) {
                        warnings.push({
                            key: `inverted-${t.id}-${slot.slot_id}`,
                            message: `「${t.name}」の終了時刻が開始時刻以前になっています。日跨ぎの場合は「翌日」にチェックを入れてください。`
                        });
                    } else {
                        allIntervals.push({ projectId: selectedProjectId, projectName: ap?.name || '現在の現場', taskName: t.name, start: s, end: e, slotId: slot.slot_id });
                    }
                }
            });
        });

        for (let i = 0; i < allIntervals.length; i++) {
            for (let j = i + 1; j < allIntervals.length; j++) {
                const a = allIntervals[i];
                const b = allIntervals[j];
                
                if (a.slotId && b.slotId && a.slotId === b.slotId) continue;

                if (a.start < b.end && b.start < a.end) {
                    const overlapStart = Math.max(a.start, b.start);
                    const overlapEnd = Math.min(a.end, b.end);
                    
                    const isSameProject = String(a.projectId) === String(b.projectId);
                    const nameA = isSameProject ? a.taskName : a.projectName;
                    const nameB = isSameProject ? b.taskName : b.projectName;
                    
                    const key = `overlap-${a.projectId}-${a.taskName}-${a.start}-${b.projectId}-${b.taskName}-${b.start}`;
                    if (!warnings.some(w => w.key === key)) {
                        warnings.push({
                            key,
                            message: `「${nameA}」と「${nameB}」の作業時間が ${fmt(overlapStart)}〜${fmt(overlapEnd)} で重複しています`
                        });
                    }
                }
            }
        }
        return warnings;
    }, [workerDailyAllRecords, tasks, selectedProjectId, projects]);

    // 現在編集中の 現場+日付 のドラフトは「入力中の自動保存」であり、
    // ユーザーが今まさに見ている内容そのものなので通知不要。
    // 通信エラーで保存された下書き、または他の現場/日付の未送信下書きのみを通知対象とする。
    const notifiableDraftQueue = useMemo(() => {
        return draftQueue.filter(d => {
            const isCurrent = String(d.selectedProjectId) === String(selectedProjectId) && d.selectedDate === selectedDate;
            return !d.isAutoSaved || !isCurrent;
        });
    }, [draftQueue, selectedProjectId, selectedDate]);

    // ========== ドラフト（オフライン下書き）操作 ==========
    const handleRestoreDraft = async (draft) => {
        const ok = await confirm({
            title: '下書きの復元',
            message: '下書きを復元しますか？（現在の入力内容は上書きされます）',
            confirmText: '復元する',
            variant: 'primary',
        });
        if (!ok) return;
        setSelectedProjectId(draft.selectedProjectId);
        setSelectedDate(draft.selectedDate);
        setTasks(draft.tasks || []);
        setSubcontractors(draft.subcontractors || []);
        setDeletedSubcontractorIds(draft.deletedSubcontractorIds || []);
        setHasUnsavedChanges(true);
        showToast('下書きを復元しました。内容を確認し「今日の実績を送信」ボタンを押してください。', 'success');
    };

    const handleDiscardDraft = async (draft) => {
        const ok = await confirm({
            title: '下書きの破棄',
            message: '未送信の下書きを本当に破棄しますか？',
            confirmText: '破棄する',
        });
        if (!ok) return;
        const remaining = removeDraft(draft.selectedProjectId, draft.selectedDate);
        setDraftQueue(remaining);
    };

    // ========== 入力済み現場レコードの削除 ==========
    const handleDeleteProjectRecords = async (project) => {
        const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
        const ok = await confirm({
            title: '入力記録の削除',
            message: `「${project.name}」の ${dateLabel} の入力記録をすべて削除しますか？\nこの操作は取り消せません。`,
            confirmText: '削除する',
            variant: 'danger',
        });
        if (!ok) return;

        try {
            const { error } = await supabase
                .from('TaskRecords')
                .delete()
                .eq('worker_name', loggedInWorker.name)
                .eq('date', selectedDate)
                .eq('project_id', project.id);
            if (error) throw error;

            // workerDailyAllRecords を再取得
            const { data: refreshed } = await supabase
                .from('TaskRecords')
                .select('*')
                .eq('worker_name', loggedInWorker.name)
                .eq('date', selectedDate);
            setWorkerDailyAllRecords(refreshed || []);

            // 削除した現場が現在選択中なら入力欄をリセット
            if (String(selectedProjectId) === String(project.id)) {
                setTasks(prev => prev.map(t => ({
                    ...t,
                    time_slots: [{ slot_id: `new-${Date.now()}-${t.id}`, record_id: null, start_time: '', end_time: '', is_overnight: false }],
                    deleted_record_ids: [],
                    today_note: '',
                    work_allowance: false,
                })));
                setHasUnsavedChanges(false);
            }

            showToast(`「${project.name}」の入力記録を削除しました。`, 'success');
        } catch (e) {
            console.error(e);
            showToast('削除に失敗しました。', 'error');
        }
    };

    // ========== 送信 ==========
    const handleSubmit = async () => {
        if (!selectedProjectId || tasks.length === 0) return;
        
        let hasValidationError = false;

        // 片方未入力チェック & 異常時間チェック
        for (const t of tasks) {
            for (let j = 0; j < t.time_slots.length; j++) {
                const slot = t.time_slots[j];
                const tc = tasksWithCalculation.find(calcItem => calcItem.id === t.id);
                const sc = tc ? tc.slotCalcs[j] : { netWorkHours: 0 };
                
                if ((slot.start_time && !slot.end_time) || (!slot.start_time && slot.end_time)) {
                    showToast(`「${t.name}」の作業時間が片方しか入力されていません。`, 'error');
                    hasValidationError = true;
                }
                if (sc.netWorkHours > 16) {
                    showToast(`「${t.name}」の実働時間が16時間を超えています。入力内容を確認してください。`, 'error');
                    hasValidationError = true;
                }
            }
        }
        
        if (subcontractors.some(s => s.company_name && (s.worker_count <= 0 || !Number.isInteger(Number(s.worker_count))))) {
            showToast('協力業者の人数は1以上の整数を入力してください。', 'error');
            hasValidationError = true;
        }

        if (hasValidationError) return;

        if (timeOverlapWarnings.length > 0) {
            showToast('時間の重複または不整合の警告が出ています。入力内容を修正してください。', 'error');
            return;
        }
        setIsSaving(true);
        setSaveMessage('');
        try {
            const targetDate = selectedDate;
            const project = projects.find(p => p.id === Number(selectedProjectId));
            const isForeman = project && project.foreman_worker_id === loggedInWorker.id;

            // --- 1件ずつの逐次 await（N+1）を避け、操作種別ごとにまとめて実行する ---
            const deleteIds = [];          // 削除する TaskRecords の id
            const updateOps = [];          // { id, data } 更新対象
            const insertPayloads = [];     // 新規 insert する行
            const insertSlotRefs = [];     // insertPayloads と並列：返り id を書き戻すスロット参照

            for (let i = 0; i < tasks.length; i++) {
                const t = tasks[i];
                const tc = tasksWithCalculation[i];

                // 削除対象（明示的に削除されたレコード）
                for (const delId of t.deleted_record_ids) deleteIds.push(delId);

                for (let j = 0; j < t.time_slots.length; j++) {
                    const slot = t.time_slots[j];
                    const sc = tc.slotCalcs[j];

                    if (!slot.start_time || !slot.end_time) {
                        // 空スロットで既存レコードがある場合は削除
                        if (slot.record_id) {
                            deleteIds.push(slot.record_id);
                            slot.record_id = null;
                        }
                        continue;
                    }

                    const recordData = {
                        hours: sc.netWorkHours || 0,
                        overtime_hours: sc.overtimeHours || 0,
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        note: j === 0 ? (t.today_note || '') : '',
                        work_allowance: t.work_allowance || false,
                    };

                    if (slot.record_id) {
                        updateOps.push({ id: slot.record_id, data: recordData });
                    } else {
                        insertPayloads.push({
                            ...recordData,
                            project_id: selectedProjectId,
                            project_task_id: t.id,
                            date: targetDate,
                            worker_name: loggedInWorker.name,
                        });
                        insertSlotRefs.push(slot);
                    }
                }
            }

            // 削除はまとめて1回
            if (deleteIds.length > 0) {
                const { error } = await supabase.from('TaskRecords').delete().in('id', deleteIds);
                if (error) throw error;
            }

            // 更新・進捗更新は並列実行
            const parallelOps = updateOps.map(u =>
                supabase.from('TaskRecords').update(u.data).eq('id', u.id)
            );
            if (isForeman) {
                tasks.forEach(t => {
                    parallelOps.push(supabase.from('ProjectTasks').update({ progress_percentage: t.progress_percentage }).eq('id', t.id));
                });
            }
            if (parallelOps.length > 0) {
                const results = await Promise.all(parallelOps);
                const failed = results.find(r => r.error);
                if (failed) throw failed.error;
            }

            // 新規 insert はまとめて1回（返り順は入力順と一致するため id を書き戻す）
            if (insertPayloads.length > 0) {
                const { data, error } = await supabase.from('TaskRecords').insert(insertPayloads).select();
                if (error) throw error;
                (data || []).forEach((row, k) => {
                    if (insertSlotRefs[k]) insertSlotRefs[k].record_id = row.id;
                });
            }

            // 協力業者
            if (isForeman) {
                if (deletedSubcontractorIds.length > 0) {
                    const { error } = await supabase.from('SubcontractorRecords').delete().in('id', deletedSubcontractorIds);
                    if (error) throw error;
                }
                const subOps = [];
                const subInsertPayloads = [];
                for (const s of subcontractors) {
                    if (!s.company_name) continue;
                    if (String(s.id).startsWith('temp-')) {
                        subInsertPayloads.push({ project_id: selectedProjectId, date: targetDate, company_name: s.company_name, worker_count: s.worker_count, unit_price: 0, worker_name: loggedInWorker.name });
                    } else {
                        subOps.push(supabase.from('SubcontractorRecords').update({ company_name: s.company_name, worker_count: s.worker_count }).eq('id', s.id));
                    }
                }
                if (subInsertPayloads.length > 0) {
                    subOps.push(supabase.from('SubcontractorRecords').insert(subInsertPayloads));
                }
                if (subOps.length > 0) {
                    const subResults = await Promise.all(subOps);
                    const subFailed = subResults.find(r => r.error);
                    if (subFailed) throw subFailed.error;
                }
            }

            // 残業承認の同期（その日・その現場・この作業員の残業合計で起票/更新/削除）
            try {
                const overtimeTotal = tasksWithCalculation.reduce(
                    (sum, tc) => sum + (Number(tc.total_overtime) || 0), 0
                );
                await syncOvertimeApproval({
                    projectId: selectedProjectId,
                    workerName: loggedInWorker.name,
                    date: targetDate,
                    overtimeTotal,
                    reason: overtimeReason,
                });
            } catch (e) {
                console.error('Overtime approval sync error:', e);
                /* 残業承認の同期失敗は日報保存自体は成功扱いとし、致命的にはしない */
            }

            // 作業手当承認の同期（その日・その現場・この作業員で手当対象にチェックされた工種名で起票/更新/削除）
            try {
                const allowanceTaskNames = tasks.filter(t => t.work_allowance).map(t => t.name);
                await syncWorkAllowanceApproval({
                    projectId: selectedProjectId,
                    workerName: loggedInWorker.name,
                    date: targetDate,
                    taskNames: allowanceTaskNames,
                });
            } catch (e) {
                console.error('Work allowance approval sync error:', e);
                /* 作業手当承認の同期失敗は日報保存自体は成功扱いとし、致命的にはしない */
            }

            // リフレッシュ
            try {
                const { data: refreshed } = await supabase.from('TaskRecords').select('*').eq('worker_name', loggedInWorker.name).eq('date', targetDate);
                setWorkerDailyAllRecords(refreshed || []);
            } catch (e) { /* ignore */ }

            setDraftQueue(removeDraft(selectedProjectId, selectedDate));
            setHasUnsavedChanges(false);

            setSaveMessage('日報を送信しました！お疲れ様です。');
            setTimeout(() => setSaveMessage(''), 5000);
        } catch (error) {
            console.error('Submit error:', error);
            if (!navigator.onLine || error.message?.includes('fetch') || error.message?.includes('Network')) {
                const entry = upsertDraft({
                    selectedProjectId,
                    selectedDate,
                    tasks,
                    subcontractors,
                    deletedSubcontractorIds,
                });
                setDraftQueue(prev => {
                    const key = `${entry.selectedProjectId}__${entry.selectedDate}`;
                    const others = prev.filter(d => `${d.selectedProjectId}__${d.selectedDate}` !== key);
                    return [...others, entry];
                });
                showToast('通信エラーが発生したため、未送信の下書きとして保存しました。', 'warning');
            } else {
                showToast('保存に失敗しました。電波の良いところで再度お試しください。', 'error');
            }
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
                        <p className="text-sm font-bold text-slate-500 mb-8">名前を選んでください</p>
                        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto px-1 pb-4">
                            {workers.map(w => (
                                <button key={w.id} onClick={() => handleLogin(w)}
                                    className="w-full bg-slate-50 border-2 border-slate-200 p-4 rounded-xl text-lg font-bold text-slate-700 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 transition active:scale-[0.98]"
                                >{w.name}</button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ========== メイン画面 ==========
    const activeProject = projects.find(p => p.id === Number(selectedProjectId));
    const isForeman = activeProject && activeProject.foreman_worker_id === loggedInWorker.id;
    const seasonConfig = getSeasonConfig(selectedDate);

    const totalInputHours = tasksWithCalculation.reduce((s, t) => s + (t.total_hours || 0), 0);
    const totalInputOvertimeHours = tasksWithCalculation.reduce((s, t) => s + (t.total_overtime || 0), 0);
    const currentSiteNinku = calculateNinku(totalInputHours, selectedDate);

    const otherProjectsHours = workerDailyAllRecords
        .filter(r => String(r.project_id) !== String(selectedProjectId))
        .reduce((s, r) => s + (Number(r.hours) || 0) + (Number(r.overtime_hours) || 0), 0);
    const totalDailyHours = totalInputHours + otherProjectsHours;


    let foremanSummary = null;
    if (isForeman) {
        const totalTarget = tasks.reduce((s, t) => s + (Number(t.target_hours) || 0), 0);
        let totalActual = 0, predictedProfitLoss = 0;
        tasks.forEach(t => {
            const actual = allProjectRecords.filter(r => r.project_task_id === t.id).reduce((s, r) => s + Number(r.hours), 0);
            totalActual += actual;
            const progress = t.progress_percentage || 0;
            const predictedFinal = progress > 0 ? (actual / (progress / 100)) : 0;
            predictedProfitLoss += progress > 0 ? (t.target_hours - predictedFinal) * hourlyWage : 0;
        });
        const subCost = allSubcontractorRecords.reduce((s, r) => s + (Number(r.worker_count) * Number(r.unit_price || 0)), 0);
        const overallProgress = totalTarget > 0 ? tasks.reduce((s, t) => s + (t.target_hours * (t.progress_percentage || 0)), 0) / totalTarget : 0;
        foremanSummary = { totalTarget, totalActual, overallProgress: Math.round(overallProgress), predictedProfitLoss: Math.round(predictedProfitLoss - subCost) };
    }

    const seasonLabel = seasonConfig.label;
    const scheduledStartStr = `${Math.floor(seasonConfig.scheduledStart / 60)}:${String(seasonConfig.scheduledStart % 60).padStart(2, '0')}`;
    const scheduledEndStr = `${Math.floor(seasonConfig.scheduledEnd / 60)}:${String(seasonConfig.scheduledEnd % 60).padStart(2, '0')}`;

    return (
        <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-24">
            <header className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-40 flex items-center justify-between">
                <div className="flex items-center gap-2"><HardHat size={20} /><span className="font-bold text-lg leading-none">{loggedInWorker.name}</span></div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleExportReportPDF}
                        disabled={isExportingPDF}
                        aria-label="日報出力"
                        title="日報出力"
                        className="flex items-center gap-1 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 px-3 py-1.5 rounded-lg text-sm font-bold transition"
                    >
                        {isExportingPDF ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} 日報出力
                    </button>
                    <div
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${isOnline ? 'bg-blue-700' : 'bg-orange-500'}`}
                        title={isOnline ? 'オンライン' : 'オフライン'}
                    >
                        {isOnline ? <Wifi size={14} aria-label="オンライン" /> : <WifiOff size={14} aria-label="オフライン" />}
                        {!isOnline && <span>オフライン</span>}
                    </div>
                    {notifiableDraftQueue.length > 0 && (
                        <div
                            className="flex items-center gap-1 bg-orange-500 px-2 py-1 rounded-lg text-xs font-bold"
                            title={`未送信の下書き ${notifiableDraftQueue.length}件`}
                        >
                            <AlertCircle size={14} /> {notifiableDraftQueue.length}
                        </div>
                    )}
                    <button onClick={handleLogout} aria-label="終了" title="終了" className="flex items-center gap-1 bg-blue-700 hover:bg-blue-800 px-3 py-1.5 rounded-lg text-sm font-bold transition"><LogOut size={16} /> 終了</button>
                </div>
            </header>

            <main className="p-4 max-w-lg mx-auto">
                {notifiableDraftQueue.length > 0 && (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 shadow-sm">
                        <div className="flex items-center gap-2 text-orange-700 font-bold mb-2 text-sm">
                            <AlertCircle size={18} /> 未送信のデータが{notifiableDraftQueue.length}件あります
                        </div>
                        <div className="space-y-2">
                            {notifiableDraftQueue.map((draft) => {
                                const projectName = projects.find(p => String(p.id) === String(draft.selectedProjectId))?.name || '（現場名不明）';
                                return (
                                    <div key={`${draft.selectedProjectId}__${draft.selectedDate}`} className="bg-white/60 rounded-lg p-2">
                                        <p className="text-xs text-orange-600 mb-2 font-medium">
                                            {projectName}（{draft.selectedDate}）<br />
                                            {draft.isAutoSaved ?
                                                `${new Date(draft.timestamp).toLocaleString('ja-JP')} に入力中のデータが自動保存されています。` :
                                                `${new Date(draft.timestamp).toLocaleString('ja-JP')} に通信エラーで保存されたデータがあります。復元して再送信してください。`}
                                        </p>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleRestoreDraft(draft)} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 rounded-lg text-xs transition shadow-sm">
                                                下書きを復元する
                                            </button>
                                            <button onClick={() => handleDiscardDraft(draft)} className="px-3 bg-white text-orange-500 border border-orange-200 hover:bg-orange-100 font-bold py-2 rounded-lg text-xs transition">
                                                破棄
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-600 mb-2">作業日</label>
                    <div className="flex items-center gap-2 mb-2">
                        <button
                            type="button"
                            onClick={async () => {
                                if (hasUnsavedChanges && !(await confirm({
                                    title: '別の日に移動',
                                    message: '未送信の入力データがあります。破棄して別の日に移動しますか？',
                                    confirmText: '破棄して移動',
                                }))) return;
                                setHasUnsavedChanges(false);
                                const d = new Date(selectedDate + 'T00:00:00');
                                d.setDate(d.getDate() - 1);
                                setSelectedDate(formatDateLocal(d));
                            }}
                            aria-label="前日に移動"
                            title="前日に移動"
                            className="shrink-0 w-12 h-12 flex items-center justify-center bg-white border-2 border-blue-200 text-blue-600 rounded-xl font-bold text-lg active:scale-95 transition shadow-sm"
                        >
                            ◀
                        </button>
                        <input type="date" value={selectedDate} onChange={async (e) => {
                            const value = e.target.value;
                            if (hasUnsavedChanges && !(await confirm({
                                title: '別の日に移動',
                                message: '未送信の入力データがあります。破棄して別の日に移動しますか？',
                                confirmText: '破棄して移動',
                            }))) return;
                            setHasUnsavedChanges(false);
                            setSelectedDate(value);
                        }}
                            className="flex-1 bg-white border-2 border-blue-200 text-slate-800 p-4 rounded-xl font-bold text-lg outline-none focus:border-blue-500 shadow-sm appearance-none" />
                        <button
                            type="button"
                            onClick={async () => {
                                if (hasUnsavedChanges && !(await confirm({
                                    title: '別の日に移動',
                                    message: '未送信の入力データがあります。破棄して別の日に移動しますか？',
                                    confirmText: '破棄して移動',
                                }))) return;
                                setHasUnsavedChanges(false);
                                const d = new Date(selectedDate + 'T00:00:00');
                                d.setDate(d.getDate() + 1);
                                setSelectedDate(formatDateLocal(d));
                            }}
                            aria-label="翌日に移動"
                            title="翌日に移動"
                            className="shrink-0 w-12 h-12 flex items-center justify-center bg-white border-2 border-blue-200 text-blue-600 rounded-xl font-bold text-lg active:scale-95 transition shadow-sm"
                        >
                            ▶
                        </button>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${seasonLabel === '夏季' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{seasonLabel}</span>
                        <span className="text-xs font-bold text-slate-400">定時 {scheduledStartStr}〜{scheduledEndStr}</span>
                    </div>

                    {/* 入力済み現場の表示 */}
                    {workerDailyAllRecords.length > 0 && (() => {
                        const enteredProjectIds = [...new Set(workerDailyAllRecords.map(r => r.project_id))];
                        const enteredProjects = enteredProjectIds
                            .map(pid => projects.find(p => p.id === Number(pid)))
                            .filter(Boolean);
                        return enteredProjects.length > 0 ? (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-2">
                                <div className="text-[10px] font-bold text-emerald-600 mb-1">✅ この日に入力済みの現場:</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {enteredProjects.map(p => {
                                        const isActive = String(p.id) === String(selectedProjectId);
                                        return (
                                            <span key={p.id}
                                                className={`inline-flex items-center text-xs font-bold rounded-full border active:scale-95 transition ${isActive
                                                        ? 'bg-blue-100 text-blue-700 border-blue-300'
                                                        : 'bg-white text-slate-600 border-slate-200'
                                                    }`}
                                            >
                                                {/* 現場名 → タップで切り替え */}
                                                <span
                                                    onClick={async () => {
                                                        if (hasUnsavedChanges && !(await confirm({
                                                            title: '現場の切り替え',
                                                            message: '未送信の入力データがあります。入力内容を破棄して現場を切り替えますか？',
                                                            confirmText: '破棄して切替',
                                                        }))) return;
                                                        setHasUnsavedChanges(false);
                                                        setSelectedProjectId(String(p.id));
                                                        localStorage.setItem('cost-app-worker-project', String(p.id));
                                                    }}
                                                    className="px-2.5 py-1 cursor-pointer hover:opacity-80"
                                                >
                                                    {p.name || '無題の現場'}
                                                </span>
                                                {/* 削除ボタン */}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteProjectRecords(p); }}
                                                    aria-label={`${p.name || '現場'}の入力を削除`}
                                                    title={`${p.name || '現場'}の入力を削除`}
                                                    className={`pr-2 py-1 transition ${isActive ? 'text-blue-400 hover:text-red-500' : 'text-slate-300 hover:text-red-500'}`}
                                                >
                                                    <X size={11} />
                                                </button>
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null;
                    })()}

                    {/* 時間帯重複の警告 */}
                    {timeOverlapWarnings.length > 0 && (
                        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2.5 mb-2">
                            <div className="text-[10px] font-bold text-red-600 mb-1.5 flex items-center gap-1">
                                <AlertCircle size={12} /> 作業時間の重複があります
                            </div>
                            <div className="flex flex-col gap-1">
                                {timeOverlapWarnings.map(w => (
                                    <div key={w.key} className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-1.5 rounded-lg">
                                        {w.message}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <label className="block text-sm font-bold text-slate-600 mb-2">現場を選択</label>
                    <select value={selectedProjectId} onChange={async (e) => {
                        const value = e.target.value;
                        if (hasUnsavedChanges && !(await confirm({
                            title: '現場の切り替え',
                            message: '未送信の入力データがあります。入力内容を破棄して現場を切り替えますか？',
                            confirmText: '破棄して切替',
                        }))) return;
                        setHasUnsavedChanges(false);
                        setSelectedProjectId(value);
                        localStorage.setItem('cost-app-worker-project', value);
                    }}
                        className="w-full bg-white border-2 border-blue-200 text-slate-800 p-4 rounded-xl font-bold text-lg outline-none focus:border-blue-500 shadow-sm appearance-none">
                        <option value="">現場を選ぶ...</option>
                        {projects.filter(p => ["【会社】社内業務・雑務", "【会社】有給", "有給", "【有給】"].includes(p.name)).map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                        {projects.filter(p => !["【会社】社内業務・雑務", "【会社】有給", "有給", "【有給】"].includes(p.name) && p.status === PROJECT_STATUS.IN_PROGRESS).map(p => (<option key={p.id} value={p.id}>{p.name || '無題の現場'}</option>))}
                    </select>
                </div>

                {isLoading && selectedProjectId && <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>}

                {!isLoading && selectedProjectId && tasks.length === 0 && (
                    <div className="text-center p-10 bg-white rounded-xl border-dashed border-2 border-slate-300">
                        <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-500 font-bold">この現場には作業項目がありません。</p>
                    </div>
                )}

                {!isLoading && selectedProjectId && tasks.length > 0 && (
                    <div className="flex flex-col gap-4">
                        {/* 職長ダッシュボード */}
                        {isForeman && foremanSummary && (
                            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-2">
                                <div className="bg-green-600 px-4 py-3 flex gap-2 items-center text-white shadow-sm">
                                    <CheckCircle2 className="shrink-0 w-5 h-5" /><h3 className="font-bold text-sm">職長ダッシュボード</h3>
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
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 職長: 承認待ちの残業申請 */}
                        {isForeman && pendingApprovals.length > 0 && (
                            <div className="bg-white border border-amber-200 rounded-2xl shadow-sm overflow-hidden mb-2">
                                <div className="bg-amber-500 px-4 py-3 flex gap-2 items-center text-white shadow-sm">
                                    <Clock className="shrink-0 w-5 h-5" />
                                    <h3 className="font-bold text-sm">承認待ちの残業（{pendingApprovals.length}件）</h3>
                                </div>
                                <div className="p-3 flex flex-col gap-2 bg-amber-50">
                                    {pendingApprovals.map(a => {
                                        const proj = projects.find(p => p.id === Number(a.project_id));
                                        return (
                                            <div key={a.id} className="bg-white border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-800 truncate">{a.worker_name}</div>
                                                    <div className="text-[11px] text-slate-500 font-medium truncate">
                                                        {a.date} ・ {proj?.name || '現場'}
                                                    </div>
                                                    <div className="text-xs font-black text-orange-600 mt-0.5">
                                                        残業 {Number(a.requested_hours).toFixed(1)}H
                                                    </div>
                                                    {a.reason && (
                                                        <div className="text-[11px] text-slate-600 mt-1 bg-slate-50 rounded px-2 py-1 break-words">
                                                            {a.reason}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleApproveOvertime(a.id)}
                                                    disabled={approvingId === a.id}
                                                    className="shrink-0 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold text-sm px-4 py-2 rounded-lg transition active:scale-95 flex items-center gap-1"
                                                >
                                                    {approvingId === a.id
                                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                                        : <CheckCircle2 className="w-4 h-4" />}
                                                    承認
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 職長: 承認待ちの作業手当申請 */}
                        {isForeman && pendingAllowanceApprovals.length > 0 && (
                            <div className="bg-white border border-indigo-200 rounded-2xl shadow-sm overflow-hidden mb-2">
                                <div className="bg-indigo-500 px-4 py-3 flex gap-2 items-center text-white shadow-sm">
                                    <CheckCircle2 className="shrink-0 w-5 h-5" />
                                    <h3 className="font-bold text-sm">承認待ちの作業手当（{pendingAllowanceApprovals.length}件）</h3>
                                </div>
                                <div className="p-3 flex flex-col gap-2 bg-indigo-50">
                                    {pendingAllowanceApprovals.map(a => {
                                        const proj = projects.find(p => p.id === Number(a.project_id));
                                        return (
                                            <div key={a.id} className="bg-white border border-indigo-200 rounded-xl p-3 flex items-center justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-slate-800 truncate">{a.worker_name}</div>
                                                    <div className="text-[11px] text-slate-500 font-medium truncate">
                                                        {a.date} ・ {proj?.name || '現場'}
                                                    </div>
                                                    <div className="text-xs font-black text-indigo-600 mt-0.5 break-words">
                                                        作業手当: {(a.task_names || []).map(name => {
                                                            const hours = a.task_hours?.[name];
                                                            return hours != null ? `${name} ${hours.toFixed(1)}h` : name;
                                                        }).join('、')}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleApproveWorkAllowance(a.id)}
                                                    disabled={approvingAllowanceId === a.id}
                                                    className="shrink-0 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold text-sm px-4 py-2 rounded-lg transition active:scale-95 flex items-center gap-1"
                                                >
                                                    {approvingAllowanceId === a.id
                                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                                        : <CheckCircle2 className="w-4 h-4" />}
                                                    承認
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ========== 作業項目カード ========== */}
                        {tasksWithCalculation.map((t) => (
                            <div key={t.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between items-center">
                                    <h3 className="font-bold text-slate-800 leading-snug">{t.name}</h3>
                                    {t.has_any_input && (
                                        <span className="text-sm font-black text-emerald-600">{t.total_hours.toFixed(1)}h</span>
                                    )}
                                </div>
                                <div className="p-4 flex flex-col gap-3">
                                    {/* 時間帯リスト */}
                                    <label className="block text-xs font-bold text-slate-400 flex items-center gap-1">
                                        <Clock size={12} /> 作業時間
                                    </label>

                                    {t.time_slots.map((slot, slotIdx) => {
                                        const sc = t.slotCalcs[slotIdx];
                                        return (
                                            <div key={slot.slot_id} className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1">
                                                        {slotIdx === 0 && <label className="block text-[10px] font-bold text-slate-400 mb-1">開始</label>}
                                                        <input type="time" step="900" value={slot.start_time || ''}
                                                            onChange={(e) => updateSlotField(t.id, slot.slot_id, 'start_time', e.target.value)}
                                                            className="w-full h-12 text-center text-lg font-bold text-blue-600 bg-blue-50 border-2 border-blue-100 rounded-xl outline-none focus:border-blue-400 transition" />
                                                    </div>
                                                    <span className={`text-slate-400 font-black text-lg ${slotIdx === 0 ? 'mt-5' : ''}`}>〜</span>
                                                    <div className="flex-1">
                                                        {slotIdx === 0 && <label className="block text-[10px] font-bold text-slate-400 mb-1">終了</label>}
                                                        <input type="time" step="900" value={slot.end_time || ''}
                                                            onChange={(e) => updateSlotField(t.id, slot.slot_id, 'end_time', e.target.value)}
                                                            className="w-full h-12 text-center text-lg font-bold text-blue-600 bg-blue-50 border-2 border-blue-100 rounded-xl outline-none focus:border-blue-400 transition" />
                                                    </div>
                                                    <div className={`flex flex-col justify-center ${slotIdx === 0 ? 'mt-5' : ''}`}>
                                                        <label className="flex items-center gap-1 bg-white border-2 border-slate-200 px-2 h-12 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                                                            <input type="checkbox" checked={slot.is_overnight || false} onChange={(e) => updateSlotField(t.id, slot.slot_id, 'is_overnight', e.target.checked)} className="w-4 h-4 text-blue-600 cursor-pointer" />
                                                            <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap leading-none">翌日</span>
                                                        </label>
                                                    </div>
                                                    {/* 削除ボタン（スロットが2つ以上の場合のみ） */}
                                                    {t.time_slots.length > 1 && (
                                                        <button onClick={() => removeTimeSlot(t.id, slot.slot_id, slot.record_id)}
                                                            aria-label="この時間帯を削除" title="この時間帯を削除"
                                                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition shrink-0 ${slotIdx === 0 ? 'mt-5' : ''}`}>
                                                            <X size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                                {/* このスロットの計算結果バッジ */}
                                                {sc.has_input && (
                                                    <div className="flex items-center gap-1.5 ml-1 flex-wrap">
                                                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">実働 {sc.netWorkHours.toFixed(1)}h</span>
                                                        {sc.overtimeHours > 0 && <span className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">時間外 {sc.overtimeHours.toFixed(1)}h</span>}
                                                        {sc.breakMinutes > 0 && <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">休憩{sc.breakMinutes}分控除</span>}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* 時間帯追加ボタン */}
                                    <button onClick={() => addTimeSlot(t.id)}
                                        className="w-full border-2 border-dashed border-blue-200 text-blue-500 hover:bg-blue-50 hover:border-blue-400 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition">
                                        <PlusCircle size={14} /> 時間帯を追加
                                    </button>

                                    {/* 合計表示（複数スロットの場合） */}
                                    {t.has_any_input && t.time_slots.length > 1 && (
                                        <div className="flex items-center gap-2 flex-wrap bg-emerald-50 border border-emerald-200 p-2 rounded-lg">
                                            <span className="text-xs font-bold text-emerald-700">合計: {t.total_hours.toFixed(1)}h</span>
                                            {t.total_overtime > 0 && <span className="text-xs font-bold text-orange-600">（うち時間外 {t.total_overtime.toFixed(1)}h）</span>}
                                        </div>
                                    )}

                                    {/* 作業手当 */}
                                    {t.has_any_input && (
                                        <label className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition select-none ${t.work_allowance ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                                            <input type="checkbox" checked={t.work_allowance || false}
                                                onChange={(e) => updateTaskField(t.id, 'work_allowance', e.target.checked)}
                                                className="w-5 h-5 text-amber-500 accent-amber-500 cursor-pointer" />
                                            <span className={`text-sm font-bold ${t.work_allowance ? 'text-amber-700' : 'text-slate-500'}`}>作業手当の対象</span>
                                        </label>
                                    )}

                                    {/* メモ */}
                                    {t.has_any_input && (
                                        <input type="text" placeholder="メモ（任意）" value={t.today_note || ''}
                                            onChange={(e) => updateTaskField(t.id, 'today_note', e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 p-3 rounded-lg text-sm outline-none focus:border-blue-400" />
                                    )}

                                    {/* 職長のみ進捗 */}
                                    {isForeman && (
                                        <div className="mt-2 pt-4 border-t border-slate-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <label className="text-xs font-bold text-green-700">現在の進捗率</label>
                                                <span className="font-black text-green-700">{t.progress_percentage}%</span>
                                            </div>
                                            <input type="range" min="0" max="100" step="5" value={t.progress_percentage || 0}
                                                onChange={(e) => updateTaskField(t.id, 'progress_percentage', Number(e.target.value))}
                                                className="w-full h-3 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-600" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* 新規作業項目追加 */}
                        <button onClick={handleAddNewTask}
                            className="bg-white border-2 border-dashed border-slate-300 text-slate-500 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition">
                            <PlusCircle size={20} /> 新しい作業項目を追加
                        </button>

                        {/* 残業理由（残業がある場合のみ・任意） */}
                        {totalInputOvertimeHours > 0 && (
                            <div className="bg-white rounded-2xl shadow-sm border border-orange-200 overflow-hidden mt-2">
                                <div className="bg-orange-50 px-4 py-3 border-b border-orange-100 flex items-center gap-2">
                                    <Clock size={16} className="text-orange-500" />
                                    <h3 className="font-bold text-orange-800 text-sm leading-snug">
                                        残業 {totalInputOvertimeHours.toFixed(1)}H の理由（任意）
                                    </h3>
                                </div>
                                <div className="p-4">
                                    <textarea
                                        value={overtimeReason}
                                        onChange={(e) => { setOvertimeReason(e.target.value); setHasUnsavedChanges(true); }}
                                        rows={2}
                                        placeholder="例）天候による作業遅れの挽回、緊急対応 など"
                                        className="w-full bg-slate-50 border border-slate-200 p-3 rounded-lg text-sm outline-none focus:border-orange-400 resize-none"
                                    />
                                    <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                                        送信すると職長へ承認申請されます。
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* 協力業者 (職長のみ) */}
                        {isForeman && (
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-2 mb-20">
                                <div className="bg-blue-50 p-4 border-b border-blue-100 flex justify-between items-center">
                                    <h3 className="font-bold text-blue-800 leading-snug">協力業者 (常用)</h3>
                                    <button onClick={addSubcontractor} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-bold shadow-sm hover:bg-blue-700 transition">+ 追加</button>
                                </div>
                                <div className="p-4 flex flex-col gap-3">
                                    {subcontractors.length === 0 ? (
                                        <div className="text-center py-4 text-slate-400 text-sm font-bold border-2 border-dashed border-slate-100 rounded-xl">追加ボタンから業者を入力してください</div>
                                    ) : subcontractors.map(s => (
                                        <div key={s.id} className="flex gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                                            <input type="text" placeholder="会社名" value={s.company_name || ''} onChange={(e) => updateSubcontractor(s.id, 'company_name', e.target.value)}
                                                className="flex-1 min-w-0 bg-white border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none focus:border-blue-400" />
                                            <div className="flex items-center gap-1 shrink-0">
                                                <input type="number" min="0.1" step="0.1" value={s.worker_count || ''} onChange={(e) => updateSubcontractor(s.id, 'worker_count', Number(e.target.value))}
                                                    className="w-16 bg-white border border-slate-200 p-2 rounded-lg text-sm text-center font-bold outline-none focus:border-blue-400" />
                                                <span className="text-xs font-bold text-slate-500">人</span>
                                            </div>
                                            <button onClick={() => removeSubcontractor(s.id)} aria-label="協力業者を削除" title="協力業者を削除" className="w-8 h-8 flex items-center justify-center shrink-0 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={16} /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* 送信フッター */}
            {selectedProjectId && tasks.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-100 via-slate-100/90 to-transparent pointer-events-none z-40">
                    <div className="max-w-lg mx-auto flex flex-col gap-2 pointer-events-auto">
                        {saveMessage && <div className="bg-green-600 text-white text-sm font-bold p-3 rounded-xl text-center shadow-lg">{saveMessage}</div>}
                        <button onClick={handleSubmit} disabled={isSaving}
                            className="w-full bg-blue-600 text-white py-4 rounded-xl shadow-xl shadow-blue-600/20 active:bg-blue-700 transition flex flex-col justify-center items-center gap-1 disabled:opacity-70">
                            <div className="flex items-center gap-2 font-black text-lg">
                                {isSaving ? <Loader2 className="animate-spin" /> : <Save />} 今日の実績を送信
                            </div>
                            <div className="text-blue-200 text-sm font-bold flex items-center gap-1 flex-wrap justify-center">
                                この現場: <span className="text-white text-lg">{totalInputHours.toFixed(1)}</span> h
                                <span className="text-blue-300 mx-0.5">({currentSiteNinku}人工)</span>
                                {otherProjectsHours > 0 && (
                                    <><span className="mx-1 text-blue-300">│</span>本日合計: <span className="text-yellow-300 text-lg">{totalDailyHours.toFixed(1)}</span> h</>
                                )}
                            </div>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkerApp;
