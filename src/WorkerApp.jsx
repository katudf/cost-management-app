import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { Loader2, LogOut, HardHat, CheckCircle2, AlertCircle, Save, Trash2, PlusCircle, Clock, X } from 'lucide-react';
import { useToast } from './components/Toast';
import { calculateWorkHours, calculateNinku, getSeasonConfig, formatTimeDisplay } from './utils/workTimeUtils';

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
    const [workerDailyAllRecords, setWorkerDailyAllRecords] = useState([]);
    const [offlineDraft, setOfflineDraft] = useState(null);

    const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);

    // Initial load
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                const draftStr = localStorage.getItem('cost-app-unsent-draft');
                if (draftStr) {
                    try { setOfflineDraft(JSON.parse(draftStr)); } catch(e) {}
                }

                const savedWorkerStr = localStorage.getItem('cost-app-worker');
                if (savedWorkerStr) setLoggedInWorker(JSON.parse(savedWorkerStr));
                const savedProjectId = localStorage.getItem('cost-app-worker-project');
                if (savedProjectId) setSelectedProjectId(savedProjectId);

                const { data: wData } = await supabase.from('Workers').select('id, name, resignation_date').order('display_order', { ascending: true, nullsFirst: false });
                if (wData) setWorkers(wData.filter(w => w.name && w.name.trim() !== '' && !w.resignation_date));

                const { data: pData } = await supabase.from('Projects').select('*').order('created_at', { ascending: true });
                if (pData) setProjects(pData);

                const { data: settingsData } = await supabase.from('system_settings').select('hourly_wage').eq('id', 1).single();
                if (settingsData && settingsData.hourly_wage) setHourlyWage(settingsData.hourly_wage);
            } catch (error) {
                console.error('Initialization error:', error);
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, []);

    // Fetch worker daily records across ALL projects
    useEffect(() => {
        if (!loggedInWorker || !selectedDate) { setWorkerDailyAllRecords([]); return; }
        const fetch = async () => {
            try {
                const { data } = await supabase.from('TaskRecords').select('*').eq('worker_name', loggedInWorker.name).eq('date', selectedDate);
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
                const { data: tData } = await supabase.from('ProjectTasks').select('*').eq('projectId', selectedProjectId).order('order', { ascending: true });
                const { data: rData } = await supabase.from('TaskRecords').select('*').eq('project_id', selectedProjectId).eq('worker_name', loggedInWorker.name).eq('date', targetDate);
                const { data: sData } = await supabase.from('SubcontractorRecords').select('*').eq('project_id', selectedProjectId).eq('date', targetDate);

                const mappedTasks = (tData || []).map(t => {
                    // 複数レコード対応: filter で全レコード取得
                    const todayRecords = (rData || []).filter(r => r.project_task_id === t.id);
                    const time_slots = todayRecords.length > 0
                        ? todayRecords.map(r => ({
                            slot_id: `existing-${r.id}`,
                            record_id: r.id,
                            start_time: formatTimeDisplay(r.start_time) || '',
                            end_time: formatTimeDisplay(r.end_time) || '',
                        }))
                        : [{ slot_id: `new-${Date.now()}-${t.id}`, record_id: null, start_time: '', end_time: '' }];

                    return {
                        id: t.id,
                        name: t.name || '',
                        target_hours: t.target_hours || 0,
                        progress_percentage: t.progress_percentage || 0,
                        time_slots,
                        deleted_record_ids: [],
                        today_note: todayRecords.length > 0 ? (todayRecords[0].note || '') : '',
                    };
                });

                setTasks(mappedTasks);
                setSubcontractors(sData || []);
                setDeletedSubcontractorIds([]);

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
    }, [selectedProjectId, loggedInWorker, selectedDate]);

    const handleLogin = (worker) => { setLoggedInWorker(worker); localStorage.setItem('cost-app-worker', JSON.stringify(worker)); };
    const handleLogout = () => {
        if (window.confirm("ログアウトしますか？")) {
            setLoggedInWorker(null); setSelectedProjectId(''); setTasks([]); setSubcontractors([]); setDeletedSubcontractorIds([]);
            localStorage.removeItem('cost-app-worker'); localStorage.removeItem('cost-app-worker-project');
        }
    };

    // ========== タスク操作 ==========
    const updateTaskField = (taskId, field, value) => {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t));
    };

    const updateSlotField = (taskId, slotId, field, value) => {
        setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            return { ...t, time_slots: t.time_slots.map(s => s.slot_id === slotId ? { ...s, [field]: value } : s) };
        }));
    };

    const addTimeSlot = (taskId) => {
        setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            return { ...t, time_slots: [...t.time_slots, { slot_id: `new-${Date.now()}`, record_id: null, start_time: '', end_time: '' }] };
        }));
    };

    const removeTimeSlot = (taskId, slotId, recordId) => {
        setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            const newSlots = t.time_slots.filter(s => s.slot_id !== slotId);
            const newDeleted = recordId ? [...t.deleted_record_ids, recordId] : t.deleted_record_ids;
            return {
                ...t,
                time_slots: newSlots.length > 0 ? newSlots : [{ slot_id: `new-${Date.now()}`, record_id: null, start_time: '', end_time: '' }],
                deleted_record_ids: newDeleted,
            };
        }));
    };

    const addSubcontractor = () => { setSubcontractors(prev => [...prev, { id: 'temp-' + Date.now(), company_name: '', worker_count: 1 }]); };
    const updateSubcontractor = (id, field, value) => { setSubcontractors(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s)); };
    const removeSubcontractor = (id) => {
        if (!String(id).startsWith('temp-')) setDeletedSubcontractorIds(prev => [...prev, id]);
        setSubcontractors(prev => prev.filter(s => s.id !== id));
    };

    const handleAddNewTask = async () => {
        if (!selectedProjectId) return;
        const taskName = window.prompt("追加する作業項目の名称を入力してください。");
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
                    time_slots: [{ slot_id: `new-${Date.now()}`, record_id: null, start_time: '', end_time: '' }],
                    deleted_record_ids: [], today_note: '',
                }]);
            }
        } catch (e) { console.error(e); showToast('作業項目の追加に失敗しました。', 'error'); }
        finally { setIsLoading(false); }
    };

    // ========== 時間自動計算 (各タスク×各スロット) ==========
    const tasksWithCalculation = useMemo(() => {
        return tasks.map(t => {
            const slotCalcs = t.time_slots.map(slot => {
                if (slot.start_time && slot.end_time) {
                    const c = calculateWorkHours(slot.start_time, slot.end_time, selectedDate);
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
        if (!selectedProjectId || workerDailyAllRecords.length === 0) return [];

        const toMinutes = (timeStr) => {
            if (!timeStr) return null;
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };

        const allIntervals = [];
        const ap = projects.find(p => p.id === Number(selectedProjectId));

        workerDailyAllRecords
            .filter(r => String(r.project_id) !== String(selectedProjectId))
            .forEach(r => {
                const s = toMinutes(r.start_time);
                const e = toMinutes(r.end_time);
                if (s !== null && e !== null) {
                    const proj = projects.find(p => p.id === Number(r.project_id));
                    allIntervals.push({ projectId: r.project_id, projectName: proj?.name || '別現場', start: s, end: e });
                }
            });

        tasks.forEach(t => {
            t.time_slots.forEach(slot => {
                const s = toMinutes(slot.start_time);
                const e = toMinutes(slot.end_time);
                if (s !== null && e !== null) {
                    allIntervals.push({ projectId: selectedProjectId, projectName: ap?.name || '現在の現場', start: s, end: e });
                }
            });
        });

        const warnings = [];
        for (let i = 0; i < allIntervals.length; i++) {
            for (let j = i + 1; j < allIntervals.length; j++) {
                const a = allIntervals[i];
                const b = allIntervals[j];
                if (String(a.projectId) === String(b.projectId)) continue;
                if (a.start < b.end && b.start < a.end) {
                    const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
                    const overlapStart = Math.max(a.start, b.start);
                    const overlapEnd = Math.min(a.end, b.end);
                    const key = `${a.projectName}-${b.projectName}-${overlapStart}-${overlapEnd}`;
                    if (!warnings.some(w => w.key === key)) {
                        warnings.push({
                            key,
                            message: `「${a.projectName}」と「${b.projectName}」の作業時間が ${fmt(overlapStart)}〜${fmt(overlapEnd)} で重複しています`
                        });
                    }
                }
            }
        }
        return warnings;
    }, [workerDailyAllRecords, tasks, selectedProjectId, projects]);

    // ========== ドラフト（オフライン下書き）操作 ==========
    const handleRestoreDraft = () => {
        if (!window.confirm('下書きを復元しますか？（現在の入力内容は上書きされます）')) return;
        if (!offlineDraft) return;
        setSelectedProjectId(offlineDraft.selectedProjectId);
        setSelectedDate(offlineDraft.selectedDate);
        setTasks(offlineDraft.tasks || []);
        setSubcontractors(offlineDraft.subcontractors || []);
        setDeletedSubcontractorIds(offlineDraft.deletedSubcontractorIds || []);
        localStorage.removeItem('cost-app-unsent-draft');
        setOfflineDraft(null);
        showToast('下書きを復元しました。内容を確認し「今日の実績を送信」ボタンを押してください。', 'success');
    };

    const handleDiscardDraft = () => {
        if (!window.confirm('未送信の下書きを本当に破棄しますか？')) return;
        localStorage.removeItem('cost-app-unsent-draft');
        setOfflineDraft(null);
    };

    // ========== 送信 ==========
    const handleSubmit = async () => {
        if (!selectedProjectId || tasks.length === 0) return;
        setIsSaving(true);
        setSaveMessage('');
        try {
            const targetDate = selectedDate;
            const project = projects.find(p => p.id === Number(selectedProjectId));
            const isForeman = project && project.foreman_worker_id === loggedInWorker.id;

            for (let i = 0; i < tasks.length; i++) {
                const t = tasks[i];
                const tc = tasksWithCalculation[i];

                // 削除対象を処理
                for (const delId of t.deleted_record_ids) {
                    await supabase.from('TaskRecords').delete().eq('id', delId);
                }

                // 各スロットを保存
                for (let j = 0; j < t.time_slots.length; j++) {
                    const slot = t.time_slots[j];
                    const sc = tc.slotCalcs[j];

                    if (!slot.start_time || !slot.end_time) {
                        // 空スロットで既存レコードがある場合は削除
                        if (slot.record_id) {
                            await supabase.from('TaskRecords').delete().eq('id', slot.record_id);
                        }
                        continue;
                    }

                    const recordData = {
                        hours: sc.netWorkHours || 0,
                        overtime_hours: sc.overtimeHours || 0,
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        note: j === 0 ? (t.today_note || '') : '',
                    };

                    if (slot.record_id) {
                        await supabase.from('TaskRecords').update(recordData).eq('id', slot.record_id);
                    } else {
                        const { data } = await supabase.from('TaskRecords').insert([{
                            ...recordData,
                            project_id: selectedProjectId,
                            project_task_id: t.id,
                            date: targetDate,
                            worker_name: loggedInWorker.name,
                        }]).select();
                        if (data && data[0]) slot.record_id = data[0].id;
                    }
                }

                if (isForeman) {
                    await supabase.from('ProjectTasks').update({ progress_percentage: t.progress_percentage }).eq('id', t.id);
                }
            }

            // 協力業者
            if (isForeman) {
                for (const delId of deletedSubcontractorIds) { await supabase.from('SubcontractorRecords').delete().eq('id', delId); }
                for (const s of subcontractors) {
                    if (!s.company_name) continue;
                    if (String(s.id).startsWith('temp-')) {
                        await supabase.from('SubcontractorRecords').insert([{ project_id: selectedProjectId, date: targetDate, company_name: s.company_name, worker_count: s.worker_count, unit_price: 0, worker_name: loggedInWorker.name }]);
                    } else {
                        await supabase.from('SubcontractorRecords').update({ company_name: s.company_name, worker_count: s.worker_count }).eq('id', s.id);
                    }
                }
            }

            // リフレッシュ
            try {
                const { data: refreshed } = await supabase.from('TaskRecords').select('*').eq('worker_name', loggedInWorker.name).eq('date', targetDate);
                setWorkerDailyAllRecords(refreshed || []);
            } catch (e) { /* ignore */ }

            localStorage.removeItem('cost-app-unsent-draft');
            setOfflineDraft(null);

            setSaveMessage('日報を送信しました！お疲れ様です。');
            setTimeout(() => setSaveMessage(''), 5000);
        } catch (error) {
            console.error('Submit error:', error);
            if (!navigator.onLine || error.message?.includes('fetch') || error.message?.includes('Network')) {
                const draft = {
                    timestamp: new Date().toISOString(),
                    selectedProjectId,
                    selectedDate,
                    tasks,
                    subcontractors,
                    deletedSubcontractorIds
                };
                localStorage.setItem('cost-app-unsent-draft', JSON.stringify(draft));
                setOfflineDraft(draft);
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
                        <p className="text-sm font-bold text-slate-500 mb-8">自分の名前を選んでください</p>
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
                <button onClick={handleLogout} className="flex items-center gap-1 bg-blue-700 hover:bg-blue-800 px-3 py-1.5 rounded-lg text-sm font-bold transition"><LogOut size={16} /> 終了</button>
            </header>

            <main className="p-4 max-w-lg mx-auto">
                {offlineDraft && (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 shadow-sm">
                        <div className="flex items-center gap-2 text-orange-700 font-bold mb-2 text-sm">
                            <AlertCircle size={18} /> 未送信の下書きがあります
                        </div>
                        <p className="text-xs text-orange-600 mb-3 font-medium">
                            {new Date(offlineDraft.timestamp).toLocaleString('ja-JP')} に通信エラーで保存されたデータがあります。復元して再送信してください。
                        </p>
                        <div className="flex gap-2">
                            <button onClick={handleRestoreDraft} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 rounded-lg text-xs transition shadow-sm">
                                下書きを復元する
                            </button>
                            <button onClick={handleDiscardDraft} className="px-3 bg-white text-orange-500 border border-orange-200 hover:bg-orange-100 font-bold py-2 rounded-lg text-xs transition">
                                破棄
                            </button>
                        </div>
                    </div>
                )}

                <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-600 mb-2">作業日</label>
                    <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full bg-white border-2 border-blue-200 text-slate-800 p-4 rounded-xl font-bold text-lg outline-none focus:border-blue-500 shadow-sm appearance-none mb-2" />
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
                                    {enteredProjects.map(p => (
                                        <span key={p.id}
                                            onClick={() => { setSelectedProjectId(String(p.id)); localStorage.setItem('cost-app-worker-project', String(p.id)); }}
                                            className={`text-xs font-bold px-2.5 py-1 rounded-full border cursor-pointer active:scale-95 transition ${
                                                String(p.id) === String(selectedProjectId)
                                                    ? 'bg-blue-100 text-blue-700 border-blue-300'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            {p.name || '無題の現場'}
                                        </span>
                                    ))}
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
                    <select value={selectedProjectId} onChange={(e) => { setSelectedProjectId(e.target.value); localStorage.setItem('cost-app-worker-project', e.target.value); }}
                        className="w-full bg-white border-2 border-blue-200 text-slate-800 p-4 rounded-xl font-bold text-lg outline-none focus:border-blue-500 shadow-sm appearance-none">
                        <option value="">現場を選ぶ...</option>
                        {projects.filter(p => p.name === "【会社】社内業務・雑務").map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                        {projects.filter(p => p.name !== "【会社】社内業務・雑務").map(p => (<option key={p.id} value={p.id}>{p.name || '無題の現場'}</option>))}
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
                                        <div className={`text-[10px] font-bold mt-1 ${foremanSummary.predictedProfitLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                            {foremanSummary.predictedProfitLoss >= 0 ? '現在のペースなら目標達成可能！' : 'このままだとマイナスだ。至急対策を！'}
                                        </div>
                                    </div>
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
                                                    {/* 削除ボタン（スロットが2つ以上の場合のみ） */}
                                                    {t.time_slots.length > 1 && (
                                                        <button onClick={() => removeTimeSlot(t.id, slot.slot_id, slot.record_id)}
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
                                            <button onClick={() => removeSubcontractor(s.id)} className="w-8 h-8 flex items-center justify-center shrink-0 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={16} /></button>
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
