import { useToast } from '../../components/Toast';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Loader2, X, Plus, Trash2, Download, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { exportAssignmentChartToExcel } from '../../utils/assignmentChartExport';
import { toDateStr, addDays, getDayOfWeek, getMonday } from '../../utils/dateUtils';
import { DEFAULT_COLORS, SCHEDULE_TYPES } from '../../utils/constants';


const AssignmentChartTab = ({ projects, workers, allProjectsSummary, setActiveTab, setActiveProjectId, setProjects }) => {
    const { showToast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [assignments, setAssignments] = useState([]);
    const [taskRecords, setTaskRecords] = useState([]);

    // 退社済みの作業員を除外
    const activeWorkers = useMemo(() => {
        return (workers || []).filter(w => !w.resignation_date);
    }, [workers]);

    const [barProjects, setBarProjects] = useState([]);
    const [companyHolidays, setCompanyHolidays] = useState([]);

    // 会社休日のセル編集ポップアップ
    const [editHolidayCell, setEditHolidayCell] = useState(null);

    // セル編集ポップアップ
    const [editCell, setEditCell] = useState(null);
    const popupRef = useRef(null);
    const tableContainerRef = useRef(null);

    // ドラッグ選択
    const [isDragging, setIsDragging] = useState(false);
    const [dragWorkerId, setDragWorkerId] = useState(null);
    const [dragCells, setDragCells] = useState([]); // 選択中のdateStr配列
    const [dragSourceCell, setDragSourceCell] = useState(null); // ドラッグ開始セル

    // ツールチップ表示用
    const [hoverProjectStats, setHoverProjectStats] = useState(null);

    // クリップボード (コピペ用)
    const [clipboard, setClipboard] = useState(null);

    const [draggingGantt, setDraggingGantt] = useState(null);

    // ===== 日付・稼働日数ロジック (休日考慮) =====
    const isHoliday = useCallback((dateObj) => {
        const dow = dateObj.getDay();
        if (dow === 0 || dow === 6) return true;
        const dStr = toDateStr(dateObj);
        return companyHolidays.some(h => h.date === dStr && h.description !== '会議' && h.description !== '社員旅行');
    }, [companyHolidays]);

    const countWorkingDays = useCallback((startStr, endStr) => {
        let count = 0;
        const start = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T00:00:00');
        if (start > end) return 0;
        
        let p = new Date(start);
        while (p <= end) {
            if (!isHoliday(p)) count++;
            p.setDate(p.getDate() + 1);
        }
        return count;
    }, [isHoliday]);

    const addWorkingDays = useCallback((startStr, daysToAdd) => {
        let p = new Date(startStr + 'T00:00:00');
        let remaining = daysToAdd;
        while (remaining > 0) {
            p.setDate(p.getDate() + 1);
            if (!isHoliday(p)) remaining--;
        }
        return toDateStr(p);
    }, [isHoliday]);

    // 表示期間
    const [startDate, setStartDate] = useState(() => getMonday(new Date()));
    const totalDays = 56;

    // 日付配列
    const dateColumns = useMemo(() => {
        const cols = [];
        for (let i = 0; i < totalDays; i++) {
            const d = addDays(startDate, i);
            cols.push({
                date: d,
                dateStr: toDateStr(d),
                day: d.getDate(),
                month: d.getMonth() + 1,
                dow: d.getDay(),
                dowLabel: getDayOfWeek(d),
                weekIdx: Math.floor(i / 7)
            });
        }
        return cols;
    }, [startDate]);

    // 週グループ
    const weekGroups = useMemo(() => {
        const groups = [];
        for (let i = 0; i < totalDays; i += 7) {
            const weekStart = dateColumns[i];
            groups.push({
                label: `${weekStart.month}/${weekStart.day}`,
                days: dateColumns.slice(i, i + 7)
            });
        }
        return groups;
    }, [dateColumns]);

    // 今日の日付文字列
    const todayStr = useMemo(() => toDateStr(new Date()), []);

    // データ取得
    const fetchAssignments = useCallback(async () => {
        setIsLoading(true);
        try {
            const startStr = toDateStr(startDate);
            const endStr = toDateStr(addDays(startDate, totalDays - 1));

            const { data: aData } = await supabase
                .from('Assignments')
                .select('*')
                .gte('date', startStr)
                .lte('date', endStr);
            setAssignments(aData || []);

            // 過去日付の日報実績を取得
            if (todayStr > startStr) {
                const pastEndStr = todayStr < endStr ? todayStr : endStr;
                const { data: trData } = await supabase
                    .from('TaskRecords')
                    .select('id, project_id, worker_name, date')
                    .gte('date', startStr)
                    .lt('date', pastEndStr);
                setTaskRecords(trData || []);
            } else {
                setTaskRecords([]);
            }

            const { data: pData } = await supabase
                .from('Projects')
                .select('id, name, startDate, endDate, bar_color, status, display_order')
                .in('status', ['予定', '施工中'])
                .not('startDate', 'is', null)
                .not('endDate', 'is', null)
                .order('display_order', { ascending: true, nullsFirst: false })
                .order('created_at', { ascending: true });

            setBarProjects((pData || []).map((p, idx) => ({
                ...p,
                color: p.bar_color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            })));

            const { data: hData } = await supabase
                .from('CompanyHolidays')
                .select('id, date, description');
            
            setCompanyHolidays(hData || []);
        } catch (e) {
            console.error('配置表データ取得エラー:', e);
        } finally {
            setIsLoading(false);
        }
    }, [startDate, todayStr]);

    useEffect(() => {
        fetchAssignments();

        const channel = supabase
            .channel('assignments_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'Assignments' }, (payload) => {
                setAssignments(prev => {
                    if (payload.eventType === 'INSERT') {
                        if (prev.some(a => a.id === payload.new.id)) return prev;
                        
                        // 楽観的更新の中の未確定データ（temp-）と一致するか確認
                        const pendingOptimistic = prev.some(a => 
                            String(a.id).startsWith('temp-') &&
                            a.workerId === payload.new.workerId &&
                            a.date === payload.new.date &&
                            a.projectId === payload.new.projectId &&
                            a.title === payload.new.title
                        );
                        if (pendingOptimistic) return prev;
                        
                        return [...prev, payload.new];
                    }
                    if (payload.eventType === 'UPDATE') {
                        return prev.map(a => a.id === payload.new.id ? payload.new : a);
                    }
                    if (payload.eventType === 'DELETE') {
                        return prev.filter(a => a.id !== payload.old.id);
                    }
                    return prev;
                });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchAssignments]);

    // ポップアップ外クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (popupRef.current && !popupRef.current.contains(e.target)) {
                setEditCell(null);
            }
        };
        if (editCell) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [editCell]);

    // ドラッグ中のmouseup（window全体）
    useEffect(() => {
        const handleMouseUp = () => {
            if (isDragging && dragCells.length > 0 && dragWorkerId) {
                // ドラッグ終了 → ポップアップを表示して配置先を選択
                const lastDateStr = dragCells[dragCells.length - 1];
                const firstDateStr = dragCells[0];
                // ポップアップ位置は最初のセル基準
                if (dragSourceCell) {
                    setEditCell({
                        workerId: dragWorkerId,
                        dateStr: firstDateStr,
                        dragDates: [...dragCells],
                        top: dragSourceCell.top,
                        left: dragSourceCell.left
                    });
                }
            }
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [isDragging, dragCells, dragWorkerId, dragSourceCell]);

    // === ガントチャート (案件バー) ドラッグ & リサイズ ===
    const handleGanttPointerDown = useCallback((e, proj, mode) => {
        e.preventDefault();
        e.stopPropagation();
        const origWorkingDays = countWorkingDays(proj.startDate, proj.endDate);
        setDraggingGantt({
            projectId: proj.id,
            mode,
            initialStartStr: proj.startDate,
            initialEndStr: proj.endDate,
            origWorkingDays,
            startX: e.clientX,
            tempStartStr: proj.startDate,
            tempEndStr: proj.endDate
        });
    }, [countWorkingDays]);

    useEffect(() => {
        if (!draggingGantt) return;

        const handlePointerMove = (e) => {
            e.preventDefault();
            const dx = e.clientX - draggingGantt.startX;
            const diffDays = Math.round(dx / 48); // 1セル=48px
            
            let newStartStr = draggingGantt.initialStartStr;
            let newEndStr = draggingGantt.initialEndStr;

            if (draggingGantt.mode === 'move') {
                newStartStr = toDateStr(addDays(new Date(draggingGantt.initialStartStr), diffDays));
                newEndStr = addWorkingDays(newStartStr, Math.max(0, draggingGantt.origWorkingDays - 1));
            } else if (draggingGantt.mode === 'start') {
                newStartStr = toDateStr(addDays(new Date(draggingGantt.initialStartStr), diffDays));
                if (newStartStr > newEndStr) newStartStr = newEndStr;
            } else if (draggingGantt.mode === 'end') {
                newEndStr = toDateStr(addDays(new Date(draggingGantt.initialEndStr), diffDays));
                if (newEndStr < newStartStr) newEndStr = newStartStr;
            }

            setDraggingGantt(prev => ({
                ...prev,
                tempStartStr: newStartStr,
                tempEndStr: newEndStr
            }));
        };

        const handlePointerUp = async (e) => {
            e.preventDefault();
            const { projectId, tempStartStr, tempEndStr, initialStartStr, initialEndStr } = draggingGantt;
            setDraggingGantt(null);

            if (tempStartStr !== initialStartStr || tempEndStr !== initialEndStr) {
                // Optimistic Update
                setBarProjects(prev => prev.map(p => 
                    p.id === projectId ? { ...p, startDate: tempStartStr, endDate: tempEndStr } : p
                ));

                // Global Status Sync (工事設定タブへの反映用)
                if (setProjects) {
                    setProjects(prev => prev.map(p => 
                        p.id === projectId ? { ...p, startDate: tempStartStr, endDate: tempEndStr } : p
                    ));
                }

                try {
                    const { error } = await supabase.from('Projects').update({ startDate: tempStartStr, endDate: tempEndStr }).eq('id', projectId);
                    if (error) throw error;
                    showToast('工期を更新しました', 'success');
                } catch(error) {
                    console.error('工期更新エラー:', error);
                    showToast('工期の更新に失敗しました', 'error');
                }
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [draggingGantt, addWorkingDays, showToast]);


    // prj map
    const projectMap = useMemo(() => {
        const map = {};
        projects.forEach((p, idx) => {
            map[p.id] = {
                name: p.siteName || '無題',
                color: barProjects.find(bp => bp.id === p.id)?.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            };
        });
        return map;
    }, [projects, barProjects]);

    const allProjects = useMemo(() => {
        return projects
            .filter(p => p.status === '予定' || p.status === '施工中')
            .map((p, idx) => ({
                id: p.id,
                name: p.siteName || '無題',
                color: projectMap[p.id]?.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            }));
    }, [projects, projectMap]);

    const assignmentLookup = useMemo(() => {
        const lookup = {};
        assignments.forEach(a => {
            const key = `${a.workerId}_${a.date}`;
            if (!lookup[key]) lookup[key] = [];
            lookup[key].push(a);
        });
        Object.keys(lookup).forEach(key => {
            lookup[key].sort((a, b) => (a.assignment_order || 0) - (b.assignment_order || 0));
        });
        return lookup;
    }, [assignments]);

    // 日報実績ルックアップ（worker.id + date → 現場IDの配列）
    const taskRecordLookup = useMemo(() => {
        const workerNameToId = {};
        (workers || []).forEach(w => { workerNameToId[w.name] = w.id; });
        const lookup = {};
        taskRecords.forEach(tr => {
            const wId = workerNameToId[tr.worker_name];
            if (!wId) return;
            const key = `${wId}_${tr.date}`;
            if (!lookup[key]) lookup[key] = new Set();
            lookup[key].add(tr.project_id);
        });
        // Set → Array に変換
        const result = {};
        Object.keys(lookup).forEach(key => {
            result[key] = Array.from(lookup[key]);
        });
        return result;
    }, [taskRecords, workers]);

    // === キーボードとUIからのアクションハンドラ (コピー・ペースト・削除) ===
    const handleActionDelete = useCallback(async () => {
        if (!editCell) return;
        const targetDates = editCell.dragDates || [editCell.dateStr];
        const workerId = editCell.workerId;
        const toDelete = [];
        targetDates.forEach(dateStr => {
            const existing = assignmentLookup[`${workerId}_${dateStr}`] || [];
            toDelete.push(...existing);
        });
        if (toDelete.length === 0) return;

        const idsToDelete = toDelete.map(a => a.id);
        setAssignments(prev => prev.filter(a => !idsToDelete.includes(a.id)));
        try {
            await supabase.from('Assignments').delete().in('id', idsToDelete);
            showToast(`${toDelete.length}件の配置を削除しました`, 'success');
        } catch (err) {
            console.error('一括削除エラー', err);
            showToast('削除に失敗しました', 'error');
        }
        setEditCell(null);
        setDragCells([]);
    }, [editCell, assignmentLookup, setAssignments, showToast]);

    const handleActionCopy = useCallback(() => {
        if (!editCell) return;
        const targetDates = editCell.dragDates || [editCell.dateStr];
        const workerId = editCell.workerId;
        const baseDate = new Date(targetDates[0]);
        const copiedData = [];
        
        targetDates.forEach(dateStr => {
            const existing = assignmentLookup[`${workerId}_${dateStr}`] || [];
            const currentDate = new Date(dateStr);
            const dayOffset = Math.round((currentDate - baseDate) / (1000 * 60 * 60 * 24));
            
            existing.forEach(a => {
                copiedData.push({
                    dayOffset,
                    projectId: a.projectId,
                    title: a.title,
                    assignment_order: a.assignment_order
                });
            });
        });

        if (copiedData.length > 0) {
            setClipboard({ type: 'copy', data: copiedData });
            showToast(`選択範囲（${copiedData.length}件）をコピーしました`, 'success');
        }
    }, [editCell, assignmentLookup, setClipboard, showToast]);

    const handleActionCut = useCallback(async () => {
        if (!editCell) return;
        const targetDates = editCell.dragDates || [editCell.dateStr];
        const workerId = editCell.workerId;
        const baseDate = new Date(targetDates[0]);
        const copiedData = [];
        const toDelete = [];
        
        targetDates.forEach(dateStr => {
            const existing = assignmentLookup[`${workerId}_${dateStr}`] || [];
            const currentDate = new Date(dateStr);
            const dayOffset = Math.round((currentDate - baseDate) / (1000 * 60 * 60 * 24));
            
            existing.forEach(a => {
                copiedData.push({
                    dayOffset,
                    projectId: a.projectId,
                    title: a.title,
                    assignment_order: a.assignment_order
                });
                toDelete.push(a);
            });
        });

        if (copiedData.length > 0) {
            setClipboard({ type: 'cut', data: copiedData });
            
            const idsToDelete = toDelete.map(a => a.id);
            setAssignments(prev => prev.filter(a => !idsToDelete.includes(a.id)));
            try {
                await supabase.from('Assignments').delete().in('id', idsToDelete);
                showToast(`${copiedData.length}件をカットしました`, 'success');
            } catch (err) {
                console.error('カットエラー', err);
            }
            setEditCell(null);
            setDragCells([]);
        }
    }, [editCell, assignmentLookup, setClipboard, setAssignments, showToast]);

    const handleActionPaste = useCallback(async () => {
        if (!editCell || !clipboard || !clipboard.data || clipboard.data.length === 0) return;

        const targetDates = editCell.dragDates || [editCell.dateStr];
        const workerId = editCell.workerId;
        const baseDateStr = targetDates[0];
        const baseDate = new Date(baseDateStr);
        
        const newRecords = [];
        const tempIds = [];

        // 1件から複数件への「1対多展開」判定
        const isSingleDayCopy = clipboard.data.every(item => item.dayOffset === 0);
        const isMultiDayPasteTarget = targetDates.length > 1;

        if (isSingleDayCopy && isMultiDayPasteTarget) {
            targetDates.forEach(tDateStr => {
                clipboard.data.forEach(item => {
                    const tempId = `temp-${Date.now()}-${Math.random()}`;
                    tempIds.push(tempId);
                    newRecords.push({
                        id: tempId,
                        workerId: workerId,
                        projectId: item.projectId,
                        date: tDateStr,
                        title: item.title,
                        assignment_order: item.assignment_order
                    });
                });
            });
        } else {
            clipboard.data.forEach(item => {
                const targetDate = new Date(baseDate);
                targetDate.setDate(targetDate.getDate() + item.dayOffset);
                const targetDateStr = targetDate.toISOString().split('T')[0];

                const tempId = `temp-${Date.now()}-${Math.random()}`;
                tempIds.push(tempId);
                newRecords.push({
                    id: tempId,
                    workerId: workerId,
                    projectId: item.projectId,
                    date: targetDateStr,
                    title: item.title,
                    assignment_order: item.assignment_order
                });
            });
        }

        setAssignments(prev => [...prev, ...newRecords]);
        try {
            const inserts = newRecords.map(r => ({
                workerId: r.workerId,
                projectId: r.projectId,
                date: r.date,
                title: r.title,
                assignment_order: r.assignment_order
            }));

            const { data, error } = await supabase.from('Assignments').insert(inserts).select();
            if (error) throw error;
            if (data) {
                setAssignments(prev => {
                    let updated = [...prev];
                    data.forEach((d, i) => {
                        if (tempIds[i]) {
                            updated = updated.map(a => a.id === tempIds[i] ? d : a);
                        }
                    });
                    return updated;
                });
            }
            showToast(`${newRecords.length}件の配置を展開しました`, 'success');
            setEditCell(null);
            setDragCells([]);
        } catch (err) {
            console.error('ペーストエラー', err);
            setAssignments(prev => prev.filter(a => !tempIds.includes(a.id)));
            showToast('ペーストに失敗しました', 'error');
        }
    }, [editCell, clipboard, setAssignments, showToast]);

    useEffect(() => {
        const handleKeyDown = async (e) => {
            // 入力中（input, textarea）などの場合は無視
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!editCell) return; // セルが選択（ポップアップが開いている）されていないと無効
            
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                handleActionDelete();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                handleActionCopy();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                handleActionCut();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                handleActionPaste();
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editCell, handleActionDelete, handleActionCopy, handleActionCut, handleActionPaste]);

    const shortenName = (name) => {
        if (!name) return '';
        return name.length > 6 ? name.substring(0, 6) : name;
    };

    const getDayHeaderStyle = (dow, dateStr) => {
        if (dow === 0 || companyHolidays.some(h => h.date === dateStr)) return { backgroundColor: '#FEE2E2', color: '#DC2626' };
        if (dow === 6) return { backgroundColor: '#DBEAFE', color: '#2563EB' };
        return {};
    };

    const movePeriod = (weeks) => {
        setEditCell(null);
        setStartDate(prev => addDays(prev, weeks * 7));
    };

    const goToToday = () => {
        setEditCell(null);
        setStartDate(getMonday(new Date()));
    };

    const getBarSpan = (project) => {
        const pStart = new Date(project.startDate + 'T00:00:00');
        const pEnd = new Date(project.endDate + 'T00:00:00');
        const viewStart = startDate;
        const viewEnd = addDays(startDate, totalDays - 1);

        if (pEnd < viewStart || pStart > viewEnd) return null;

        const startIdx = Math.max(0, Math.round((pStart - viewStart) / (1000 * 60 * 60 * 24)));
        const endIdx = Math.min(totalDays - 1, Math.round((pEnd - viewStart) / (1000 * 60 * 60 * 24)));

        return { startIdx, endIdx, span: endIdx - startIdx + 1 };
    };

    // === 配置編集アクション（楽観的更新） ===

    const addAssignment = async (workerId, dateStr, projectId, title = null) => {
        const existingForCell = assignmentLookup[`${workerId}_${dateStr}`] || [];
        if (projectId && existingForCell.some(a => a.projectId === projectId)) return;
        if (title && existingForCell.some(a => a.title === title)) return;

        const tempId = `temp-${Date.now()}-${Math.random()}`;
        const optimisticRecord = {
            id: tempId,
            workerId,
            projectId: projectId || null,
            date: dateStr,
            title: title || null,
            assignment_order: existingForCell.length + 1
        };
        setAssignments(prev => [...prev, optimisticRecord]);

        try {
            const { data, error } = await supabase
                .from('Assignments')
                .insert([{
                    workerId,
                    projectId: projectId || null,
                    date: dateStr,
                    title: title || null,
                    assignment_order: existingForCell.length + 1
                }])
                .select();

            if (error) throw error;
            if (data && data[0]) {
                setAssignments(prev => prev.map(a => a.id === tempId ? data[0] : a));
            }
        } catch (e) {
            console.error('配置追加エラー:', e);
            setAssignments(prev => prev.filter(a => a.id !== tempId));
        }
    };

    // 複数日にまとめて配置（ドラッグ用）
    const addAssignmentBatch = async (workerId, dateStrs, projectId, title = null) => {
        const newRecords = [];
        const tempIds = [];

        for (const dateStr of dateStrs) {
            const existingForCell = assignmentLookup[`${workerId}_${dateStr}`] || [];
            if (projectId && existingForCell.some(a => a.projectId === projectId)) continue;
            if (title && existingForCell.some(a => a.title === title)) continue;

            const tempId = `temp-${Date.now()}-${Math.random()}`;
            tempIds.push(tempId);
            newRecords.push({
                id: tempId,
                workerId,
                projectId: projectId || null,
                date: dateStr,
                title: title || null,
                assignment_order: existingForCell.length + 1
            });
        }

        if (newRecords.length === 0) return;

        // UI即時反映
        setAssignments(prev => [...prev, ...newRecords]);

        // DB一括保存
        try {
            const inserts = newRecords.map(r => ({
                workerId: r.workerId,
                projectId: r.projectId,
                date: r.date,
                title: r.title,
                assignment_order: r.assignment_order
            }));

            const { data, error } = await supabase
                .from('Assignments')
                .insert(inserts)
                .select();

            if (error) throw error;
            if (data) {
                setAssignments(prev => {
                    let updated = [...prev];
                    data.forEach((d, i) => {
                        if (tempIds[i]) {
                            updated = updated.map(a => a.id === tempIds[i] ? d : a);
                        }
                    });
                    return updated;
                });
            }
        } catch (e) {
            console.error('一括配置追加エラー:', e);
            setAssignments(prev => prev.filter(a => !tempIds.includes(a.id)));
            showToast('配置の追加に失敗しました。', 'error');
        }
    };

    const removeAssignment = async (assignmentId) => {
        const removed = assignments.find(a => a.id === assignmentId);
        setAssignments(prev => prev.filter(a => a.id !== assignmentId));

        try {
            const { error } = await supabase
                .from('Assignments')
                .delete()
                .eq('id', assignmentId);

            if (error) throw error;
        } catch (e) {
            console.error('配置削除エラー:', e);
            if (removed) setAssignments(prev => [...prev, removed]);
            showToast('配置の削除に失敗しました。', 'error');
        }
    };

    const handleAssignmentReorder = async (draggedId, targetId) => {
        if (!editCell) return;
        if (draggedId === targetId) return;

        const items = [...editCellAssignments];
        const dragIdx = items.findIndex(a => a.id === draggedId);
        const targetIdx = items.findIndex(a => a.id === targetId);

        if (dragIdx === -1 || targetIdx === -1) return;

        const nextItems = [...items];
        const [draggedItem] = nextItems.splice(dragIdx, 1);
        nextItems.splice(targetIdx, 0, draggedItem);

        // 順番を振り直す
        const updatedItems = nextItems.map((item, i) => ({ ...item, assignment_order: i + 1 }));

        // Optimistic UI
        setAssignments(prev => {
            const next = [...prev];
            updatedItems.forEach(updated => {
                const idx = next.findIndex(a => a.id === updated.id);
                if (idx !== -1) next[idx] = updated;
            });
            return next;
        });

        // DB Update
        try {
            const promises = updatedItems.map(item => 
                supabase.from('Assignments').update({ assignment_order: item.assignment_order }).eq('id', item.id)
            );
            await Promise.all(promises);
        } catch (e) {
            console.error('順番変更エラー:', e);
            showToast('順番の変更に失敗しました。', 'error');
        }
    };

    const handleProjectReorder = async (draggedId, targetId) => {
        if (draggedId === targetId) return;

        setBarProjects(prev => {
            const dragIdx = prev.findIndex(p => p.id === draggedId);
            const targetIdx = prev.findIndex(p => p.id === targetId);
            if (dragIdx === -1 || targetIdx === -1) return prev;

            const next = [...prev];
            const [draggedItem] = next.splice(dragIdx, 1);
            next.splice(targetIdx, 0, draggedItem);

            // データベースの非同期更新（一意制約の競合を回避するため、MAX値を取得して新しい順序を振る）
            const performAsyncDBUpdate = async () => {
                try {
                    const { data: maxData } = await supabase
                        .from('Projects')
                        .select('display_order')
                        .not('display_order', 'is', null)
                        .order('display_order', { ascending: false })
                        .limit(1);
                    
                    const currentMax = maxData && maxData.length > 0 && maxData[0].display_order ? maxData[0].display_order : 0;
                    
                    const newProjectsData = next.map((p, idx) => ({ ...p, display_order: currentMax + idx + 1 }));

                    const promises = newProjectsData.map(p => 
                        supabase.from('Projects').update({ display_order: p.display_order }).eq('id', p.id)
                    );
                    await Promise.all(promises);

                    // 状態の display_order を更新
                    setBarProjects(current => {
                        return current.map(p => {
                            const found = newProjectsData.find(np => np.id === p.id);
                            return found ? { ...p, display_order: found.display_order } : p;
                        });
                    });
                } catch (err) {
                    console.error('案件並び順更新エラー:', err);
                    showToast('並び順の保存に失敗しました。', 'error');
                }
            };
            
            performAsyncDBUpdate();

            return next;
        });
    };

    const updateCompanyHoliday = async (dateStr, description, existingId) => {
        try {
            if (description === null && existingId) {
                // 削除
                const { error } = await supabase.from('CompanyHolidays').delete().eq('id', existingId);
                if (error) throw error;
                setCompanyHolidays(prev => prev.filter(h => h.id !== existingId));
                showToast('予定を削除しました', 'success');
            } else if (description !== null) {
                // 追加 or 更新
                const payload = {
                    date: dateStr,
                    description: description === '休日' ? null : description
                };
                if (existingId) {
                    const { data, error } = await supabase.from('CompanyHolidays').update(payload).eq('id', existingId).select();
                    if (error) throw error;
                    if (data && data.length > 0) setCompanyHolidays(prev => prev.map(h => h.id === existingId ? data[0] : h));
                } else {
                    const { data, error } = await supabase.from('CompanyHolidays').insert(payload).select();
                    if (error) throw error;
                    if (data && data.length > 0) setCompanyHolidays(prev => [...prev, data[0]]);
                }
                showToast('予定を保存しました', 'success');
            }
            setEditHolidayCell(null);
        } catch (err) {
            console.error('会社行事/休日 更新エラー:', err);
            showToast('保存に失敗しました', 'error');
        }
    };

    // === ドラッグハンドラ ===

    const handleCellMouseDown = (e, workerId, dateStr) => {
        // 右クリック無視
        if (e.button !== 0) return;
        e.preventDefault();
        setEditCell(null);
        setEditHolidayCell(null);

        const cellRect = e.currentTarget.getBoundingClientRect();
        const containerRect = tableContainerRef.current?.getBoundingClientRect();

        setIsDragging(true);
        setDragWorkerId(workerId);
        setDragCells([dateStr]);
        setDragSourceCell({
            top: cellRect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
            left: cellRect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0)
        });
    };

    const handleCellMouseEnter = (workerId, dateStr) => {
        if (!isDragging || workerId !== dragWorkerId) return;
        setDragCells(prev => {
            if (prev.length === 0) return [dateStr];
            if (prev[prev.length - 1] === dateStr) return prev; // 変更なし
            
            const startD = new Date(prev[0] + 'T00:00:00');
            const currentD = new Date(dateStr + 'T00:00:00');
            const step = startD <= currentD ? 1 : -1;
            
            const newCells = [];
            let tempD = new Date(startD);
            while (true) {
                const y = tempD.getFullYear();
                const m = String(tempD.getMonth() + 1).padStart(2, '0');
                const d = String(tempD.getDate()).padStart(2, '0');
                newCells.push(`${y}-${m}-${d}`);
                
                if (tempD.getTime() === currentD.getTime()) break;
                tempD.setDate(tempD.getDate() + step);
            }

            if (prev.length === newCells.length && prev.every((v, i) => v === newCells[i])) {
                return prev;
            }
            return newCells;
        });
    };

    // セルクリック（ドラッグなし → ポップアップ）
    const handleCellClick = (e, workerId, dateStr) => {
        setEditHolidayCell(null);
        // ドラッグ中はクリック無視（mouseupで処理）
        if (isDragging) return;
        const cellRect = e.currentTarget.getBoundingClientRect();
        const containerRect = tableContainerRef.current?.getBoundingClientRect();

        setEditCell({
            workerId,
            dateStr,
            dragDates: null,
            top: cellRect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
            left: cellRect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0)
        });
    };

    // 現場名ホバーハンドラ
    const handleProjectNameMouseEnter = (e, project) => {
        if (!allProjectsSummary) return;
        const stats = allProjectsSummary.find(p => p.id === project.id);
        if (!stats) return;

        const rect = e.currentTarget.getBoundingClientRect();
        setHoverProjectStats({
            data: stats,
            foremanName: workers.find(w => w.id === stats.foreman_worker_id)?.name || '未設定',
            top: rect.top,
            left: rect.right
        });
    };



    // ポップアップからの配置追加（ドラッグ選択対応）
    const handlePopupAssign = async (projectId, title = null) => {
        if (!editCell) return;
        const dates = editCell.dragDates || [editCell.dateStr];
        if (dates.length === 1) {
            addAssignment(editCell.workerId, dates[0], projectId, title);
        } else {
            addAssignmentBatch(editCell.workerId, dates, projectId, title);
        }
        setDragCells([]);
    };

    const periodLabel = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()} 〜 ${addDays(startDate, totalDays - 1).getMonth() + 1}/${addDays(startDate, totalDays - 1).getDate()}`;

    // 編集セルの配置データ
    const editCellAssignments = editCell
        ? (assignmentLookup[`${editCell.workerId}_${editCell.dateStr}`] || [])
        : [];

    const unassignedProjects = editCell
        ? allProjects.filter(p => !editCellAssignments.some(a => a.projectId === p.id))
        : [];

    if (isLoading && assignments.length === 0) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6" style={{ userSelect: isDragging ? 'none' : 'auto' }}>
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Calendar className="text-blue-600 w-5 h-5" /> 配置表
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportAssignmentChartToExcel(
                            workers, dateColumns, assignmentLookup, projectMap, barProjects, periodLabel, getBarSpan
                        )}
                        className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition flex items-center gap-1"
                    >
                        <Download size={14} /> Excel出力
                    </button>

                    <button
                        onClick={() => movePeriod(-8)}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
                        title="前の8週"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <button
                        onClick={goToToday}
                        className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition"
                    >
                        今日
                    </button>
                    <span className="text-sm font-bold text-slate-600 min-w-[180px] text-center">
                        {periodLabel}
                    </span>
                    <button
                        onClick={() => movePeriod(8)}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
                        title="次の8週"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>

            {isLoading && (
                <div className="h-1 bg-blue-100 overflow-hidden mb-2 rounded">
                    <div className="w-1/2 h-full bg-blue-500 animate-pulse"></div>
                </div>
            )}

            {/* ドラッグ中ヒント */}
            {isDragging && dragCells.length > 0 && (
                <div className="mb-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold flex items-center gap-2 animate-pulse">
                    📌 {dragCells.length}日選択中 — マウスを離すと配置先を選択できます
                </div>
            )}

            {/* テーブル本体 */}
            <div ref={tableContainerRef} className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm relative">
                <table className="border-collapse w-max min-w-full" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: '140px', minWidth: '140px' }} />
                        {dateColumns.map((_, i) => (
                            <col key={i} style={{ width: '48px', minWidth: '48px' }} />
                        ))}
                    </colgroup>

                    {/* 日付ヘッダー */}
                    <thead>
                        <tr>
                            <th
                                className="sticky left-0 z-20 bg-slate-700 text-white text-xs font-bold p-2 border border-slate-600"
                                rowSpan={2}
                            >
                                現場名
                            </th>
                            {weekGroups.map((wg, wi) => (
                                <th
                                    key={wi}
                                    colSpan={wg.days.length}
                                    className="bg-slate-700 text-white text-[10px] font-bold p-1 border border-slate-600 text-center"
                                >
                                    {wg.label}〜
                                </th>
                            ))}
                        </tr>
                        <tr>
                            {dateColumns.map((col, i) => (
                                <th
                                    key={i}
                                    className="text-[10px] font-bold p-1 border border-slate-300 text-center"
                                    style={{
                                        ...getDayHeaderStyle(col.dow, col.dateStr),
                                        backgroundColor: getDayHeaderStyle(col.dow, col.dateStr).backgroundColor || '#F8FAFC'
                                    }}
                                >
                                    <div>{col.day}</div>
                                    <div style={{ color: getDayHeaderStyle(col.dow, col.dateStr).color || '#64748B' }}>
                                        {col.dowLabel}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>

                    {/* 案件バーチャート */}
                    <tbody>
                        {barProjects.map((proj) => {
                            const isDraggingThis = draggingGantt && draggingGantt.projectId === proj.id;
                            const effStart = isDraggingThis ? draggingGantt.tempStartStr : proj.startDate;
                            const effEnd = isDraggingThis ? draggingGantt.tempEndStr : proj.endDate;
                            const bar = getBarSpan({ startDate: effStart, endDate: effEnd });

                            return (
                                <tr key={proj.id} className="hover:bg-slate-50 transition-colors">
                                    <td 
                                        className="sticky left-0 z-10 bg-white text-xs font-bold p-2 border border-slate-200 truncate cursor-grab hover:text-blue-600 transition"
                                        onMouseEnter={(e) => handleProjectNameMouseEnter(e, proj)}
                                        onMouseLeave={() => setHoverProjectStats(null)}
                                        draggable={!isDraggingThis}
                                        onDragStart={(e) => {
                                            if (isDraggingThis) { e.preventDefault(); return; }
                                            e.dataTransfer.setData('projectid', proj.id.toString());
                                            e.dataTransfer.effectAllowed = 'copyMove';
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            e.currentTarget.classList.add('bg-slate-200');
                                        }}
                                        onDragLeave={(e) => {
                                            e.currentTarget.classList.remove('bg-slate-200');
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.currentTarget.classList.remove('bg-slate-200');
                                            const draggedProjId = e.dataTransfer.getData('projectid');
                                            if (draggedProjId) {
                                                handleProjectReorder(parseInt(draggedProjId), proj.id);
                                            }
                                        }}
                                        title="ドラッグで上下に並び替え、またはセルに配置できます"
                                    >
                                        {proj.name}
                                    </td>
                                    {dateColumns.map((col, i) => {
                                        const isInBar = bar && i >= bar.startIdx && i <= bar.endIdx;
                                        const isBarStart = bar && i === bar.startIdx;
                                        const isHolidayOrWeekend = col.dow === 0 || col.dow === 6 || companyHolidays.some(h => h.date === col.dateStr);
                                        return (
                                            <td
                                                key={i}
                                                className="border border-slate-200 p-0 relative"
                                                style={{
                                                    backgroundColor: isInBar
                                                        ? proj.color + (isDraggingThis ? '99' : 'CC')
                                                        : isHolidayOrWeekend ? '#F9FAFB' : 'white'
                                                }}
                                            >
                                                {isBarStart && (
                                                    <div
                                                        className={`absolute inset-y-0 left-0 flex items-center text-[9px] font-bold text-white px-1 whitespace-nowrap overflow-hidden transition-none ${isDraggingThis ? 'opacity-90 scale-[1.02] shadow-md z-[30]' : 'shadow-sm z-5'}`}
                                                        style={{
                                                            width: `${bar.span * 48}px`,
                                                            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                                                            userSelect: 'none'
                                                        }}
                                                    >
                                                        <span className="relative z-10 pointer-events-none truncate">{proj.name}</span>
                                                        <div 
                                                            className="absolute left-0 top-0 bottom-0 w-3 cursor-w-resize z-20 hover:bg-white/40 border-l-2 border-white/50"
                                                            onPointerDown={(e) => handleGanttPointerDown(e, proj, 'start')}
                                                        ></div>
                                                        <div 
                                                            className="absolute left-3 right-3 top-0 bottom-0 cursor-move z-20 hover:bg-white/10"
                                                            onPointerDown={(e) => handleGanttPointerDown(e, proj, 'move')}
                                                        ></div>
                                                        <div 
                                                            className="absolute right-0 top-0 bottom-0 w-3 cursor-e-resize z-20 hover:bg-white/40 border-r-2 border-white/50"
                                                            onPointerDown={(e) => handleGanttPointerDown(e, proj, 'end')}
                                                        ></div>
                                                    </div>
                                                )}
                                                <div className="h-6"></div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}

                        {barProjects.length === 0 && (
                            <tr>
                                <td className="sticky left-0 z-10 bg-white text-xs text-slate-400 p-2 border border-slate-200 italic">
                                    案件なし
                                </td>
                                {dateColumns.map((_, i) => (
                                    <td key={i} className="border border-slate-200 p-0">
                                        <div className="h-6"></div>
                                    </td>
                                ))}
                            </tr>
                        )}
                    </tbody>

                    {/* セパレーター */}
                    <tbody>
                        <tr>
                            <td className="sticky left-0 z-20 bg-slate-700 text-white text-xs font-bold p-2 border border-slate-600">
                                作業員名
                            </td>
                            {dateColumns.map((col, i) => (
                                <td
                                    key={i}
                                    className="text-[10px] font-bold p-1 border border-slate-600 text-center"
                                    style={{
                                        backgroundColor: getDayHeaderStyle(col.dow, col.dateStr).backgroundColor || '#334155',
                                        color: getDayHeaderStyle(col.dow, col.dateStr).color || 'white'
                                    }}
                                >
                                    {col.day}
                                </td>
                            ))}
                        </tr>
                    </tbody>

                    {/* 作業員配置表 */}
                    <tbody>
                        {/* 会社行事/休日 行 */}
                        <tr className="bg-slate-100 border-b-2 border-slate-300 bg-stripes">
                            <td className="sticky left-0 z-10 bg-slate-100 text-xs font-bold p-2 border border-slate-200 truncate text-slate-600"
                                style={{ boxShadow: '2px 0 5px -2px rgba(0,0,0,0.1)' }}
                            >
                                会社行事/休日
                            </td>
                            {dateColumns.map((col, i) => {
                                const holidayObj = companyHolidays.find(h => h.date === col.dateStr);
                                const isWeekend = col.dow === 0 || col.dow === 6;
                                
                                let bgColor = 'transparent';
                                if (holidayObj) {
                                    bgColor = holidayObj.description === '会議' ? '#BAE6FD' : // light sky blue
                                              holidayObj.description === '社員旅行' ? '#DDD6FE' : // light purple
                                              '#FECACA'; // light red (default/holiday)
                                } else if (isWeekend) {
                                    bgColor = '#F1F5F9';
                                }

                                const displayText = holidayObj?.description === '会議' ? '会議' :
                                                    holidayObj?.description === '社員旅行' ? '旅行' :
                                                    holidayObj ? '休' : '';

                                const textColor = holidayObj?.description === '会議' ? 'text-sky-700' :
                                                  holidayObj?.description === '社員旅行' ? 'text-violet-700' :
                                                  'text-red-600';
                                                  
                                const isEditingEvent = editHolidayCell && editHolidayCell.dateStr === col.dateStr;

                                return (
                                    <td
                                        key={i}
                                        onClick={(e) => {
                                            setEditCell(null);
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const containerRect = tableContainerRef.current?.getBoundingClientRect();
                                            setEditHolidayCell({
                                                dateStr: col.dateStr,
                                                existingId: holidayObj?.id || null,
                                                top: rect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
                                                left: rect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0)
                                            });
                                        }}
                                        className={`border p-0 text-center align-middle cursor-pointer transition-colors relative ${isEditingEvent ? 'border-2 border-slate-500' : 'border-slate-300 hover:bg-slate-200/50'}`}
                                        style={{
                                            backgroundColor: isEditingEvent ? '#E2E8F0' : bgColor,
                                            height: '24px'
                                        }}
                                    >
                                        {holidayObj && (
                                            <div className={`flex items-center justify-center h-full text-[10px] ${textColor} font-bold`}>
                                                {displayText}
                                            </div>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>

                        {activeWorkers.map((worker, widx) => (
                            <tr key={worker.id} className={`${widx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50 transition-colors`}>
                                <td className="sticky left-0 z-10 text-xs font-bold p-2 border border-slate-200 truncate"
                                    style={{ backgroundColor: widx % 2 === 0 ? 'white' : '#F8FAFC' }}
                                    title={worker.name}
                                >
                                    <span className="text-slate-400 text-[10px] mr-1">{widx + 1}</span>
                                    {worker.name}
                                </td>
                                {dateColumns.map((col, i) => {
                                    const lookupKey = `${worker.id}_${col.dateStr}`;
                                    const cellAssignments = assignmentLookup[lookupKey] || [];
                                    const isPastDate = col.dateStr < todayStr;
                                    const actualProjectIds = isPastDate ? (taskRecordLookup[lookupKey] || []) : [];
                                    const isWeekend = col.dow === 0 || col.dow === 6;
                                    const isEditing = editCell && editCell.workerId === worker.id && (
                                        editCell.dragDates ? editCell.dragDates.includes(col.dateStr) : editCell.dateStr === col.dateStr
                                    );
                                    const isDragSelected = isDragging && dragWorkerId === worker.id && dragCells.includes(col.dateStr);

                                    // 過去日付の場合は日報実績を優先表示
                                    const displayItems = isPastDate && actualProjectIds.length > 0
                                        ? actualProjectIds.map(pid => {
                                            const pInfo = projectMap[pid];
                                            return {
                                                key: `actual-${pid}`,
                                                displayName: shortenName(pInfo?.name || '不明'),
                                                bgColor: pInfo?.color || '#94A3B8',
                                                fullName: pInfo?.name || '不明',
                                                isActual: true
                                            };
                                        })
                                        : cellAssignments.map((a, ai) => {
                                            const pInfo = a.projectId ? projectMap[a.projectId] : null;
                                            const schedType = !a.projectId && a.title ? SCHEDULE_TYPES.find(s => s.title === a.title) : null;
                                            return {
                                                key: ai,
                                                displayName: a.title || shortenName(pInfo?.name || ''),
                                                bgColor: schedType?.color || pInfo?.color || '#94A3B8',
                                                fullName: pInfo?.name || a.title || '',
                                                isActual: false
                                            };
                                        });

                                    return (
                                        <td
                                            key={i}
                                            className={`border p-0 text-center align-middle cursor-pointer transition-all ${
                                                isDragSelected
                                                    ? 'border-blue-500 border-2 bg-blue-100'
                                                    : isEditing
                                                    ? 'border-blue-500 border-2 bg-blue-50'
                                                    : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
                                            }`}
                                            style={{
                                                backgroundColor: isDragSelected ? '#DBEAFE' : isEditing ? '#EFF6FF' : isWeekend ? '#F9FAFB' : undefined,
                                                overflow: 'hidden', maxWidth: 0, width: '48px'
                                            }}
                                            onMouseDown={(e) => handleCellMouseDown(e, worker.id, col.dateStr)}
                                            onMouseEnter={() => handleCellMouseEnter(worker.id, col.dateStr)}
                                            onClick={(e) => {
                                                if (!isDragging && dragCells.length <= 1) {
                                                    handleCellClick(e, worker.id, col.dateStr);
                                                }
                                            }}
                                            onDragOver={(e) => {
                                                if (e.dataTransfer.types.includes('projectid')) {
                                                    e.preventDefault();
                                                    e.dataTransfer.dropEffect = 'copy';
                                                }
                                            }}
                                            onDrop={(e) => {
                                                const projectId = e.dataTransfer.getData('projectid');
                                                if (projectId) {
                                                    e.preventDefault();
                                                    addAssignment(worker.id, col.dateStr, Number(projectId), null);
                                                }
                                            }}
                                        >
                                            {displayItems.length > 0 ? (
                                                <div className="flex flex-col gap-0.5 p-0.5" style={{ overflow: 'hidden' }}>
                                                    {displayItems.map((item) => (
                                                        <div
                                                            key={item.key}
                                                            className={`text-[9px] font-bold rounded px-0.5 py-0.5 text-white truncate ${item.isActual ? 'ring-1 ring-inset ring-white/40' : ''}`}
                                                            style={{
                                                                backgroundColor: item.bgColor,
                                                                textShadow: '0 1px 1px rgba(0,0,0,0.3)'
                                                            }}
                                                            title={item.fullName + (item.isActual ? '（実績）' : '')}
                                                        >
                                                            {item.displayName}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="h-6"></div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}

                        {workers.length === 0 && (
                            <tr>
                                <td className="sticky left-0 z-10 bg-white text-xs text-slate-400 p-2 border border-slate-200 italic">
                                    作業員なし
                                </td>
                                {dateColumns.map((_, i) => (
                                    <td key={i} className="border border-slate-200 p-0"><div className="h-6"></div></td>
                                ))}
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* 編集ポップアップおよびツールチップ群 */}
                {editCell && (
                    <div
                        ref={popupRef}
                        className="absolute z-50 flex flex-col gap-2"
                        style={{
                            top: `${editCell.top + 4}px`,
                            left: `${Math.max(0, editCell.left - 100)}px`
                        }}
                    >
                        {/* メイン編集ポップアップ */}
                        <div
                            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-64 overflow-hidden"
                        >
                            {/* ヘッダー */}
                            <div className="bg-slate-700 text-white px-3 py-2 flex items-center justify-between">
                                <div className="text-xs font-bold">
                                    {workers.find(w => w.id === editCell.workerId)?.name} ー {
                                        editCell.dragDates && editCell.dragDates.length > 1
                                            ? `${editCell.dragDates[0].slice(5).replace('-', '/')} 〜 ${editCell.dragDates[editCell.dragDates.length-1].slice(5).replace('-', '/')} (${editCell.dragDates.length}日)`
                                            : editCell.dateStr.slice(5).replace('-', '/')
                                    }
                                </div>
                                <button
                                    onClick={() => { setEditCell(null); setDragCells([]); }}
                                    className="p-0.5 hover:bg-slate-600 rounded transition"
                                >
                                    <X size={14} />
                                </button>
                            </div>

                            {/* 現在の配置（単一セルの場合のみ） */}
                        {(!editCell.dragDates || editCell.dragDates.length <= 1) && editCellAssignments.length > 0 && (
                            <div className="px-3 py-2 border-b border-slate-100">
                                <div className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase">現在の配置</div>
                                <div className="space-y-1">
                                    {editCellAssignments.map((a, index) => {
                                        const pInfo = a.projectId ? projectMap[a.projectId] : null;
                                        const schedType = !a.projectId && a.title ? SCHEDULE_TYPES.find(s => s.title === a.title) : null;
                                        const itemColor = schedType?.color || pInfo?.color || '#94A3B8';
                                        const itemName = schedType ? `${schedType.icon} ${schedType.title}` : (pInfo?.name || '不明');
                                        return (
                                            <div
                                                key={a.id}
                                                className="flex items-center justify-between gap-2 p-1.5 rounded-lg border border-transparent hover:border-blue-200 cursor-grab active:cursor-grabbing transition"
                                                style={{ backgroundColor: itemColor + '20' }}
                                                draggable={true}
                                                onDragStart={(e) => {
                                                    e.dataTransfer.setData('assignmentid', a.id.toString());
                                                    e.dataTransfer.effectAllowed = 'copyMove';
                                                }}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    e.dataTransfer.dropEffect = 'move';
                                                    e.currentTarget.classList.add('bg-slate-200');
                                                }}
                                                onDragLeave={(e) => {
                                                    e.currentTarget.classList.remove('bg-slate-200');
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    e.currentTarget.classList.remove('bg-slate-200');
                                                    const draggedAssignmentId = e.dataTransfer.getData('assignmentid');
                                                    if (draggedAssignmentId) {
                                                        handleAssignmentReorder(parseInt(draggedAssignmentId, 10), a.id);
                                                    }
                                                }}
                                            >
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <div
                                                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                                        style={{ backgroundColor: itemColor }}
                                                    ></div>
                                                    <span className="text-xs font-bold text-slate-700 truncate">
                                                        {itemName}
                                                    </span>
                                                    {a.projectId && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (setActiveProjectId && setActiveTab) {
                                                                    setActiveProjectId(a.projectId);
                                                                    setActiveTab('master');
                                                                }
                                                            }}
                                                            className="text-slate-400 hover:text-blue-600 p-0.5 rounded hover:bg-blue-50 transition"
                                                            title="現場の詳細設定を開く"
                                                        >
                                                            <ExternalLink size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeAssignment(a.id);
                                                        }}
                                                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition ml-1"
                                                        title="配置を解除"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}


                        {/* スケジュール種別 */}
                        <div className="px-3 py-2">
                            <div className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase">その他</div>
                            <div className="flex flex-wrap gap-1">
                                {SCHEDULE_TYPES
                                    .filter(s => !editCellAssignments.some(a => a.title === s.title))
                                    .map(s => (
                                        <button
                                            key={s.title}
                                            onClick={() => { handlePopupAssign(null, s.title); }}
                                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:opacity-80 transition text-left"
                                            style={{ backgroundColor: s.color + '20', border: `1px solid ${s.color}40` }}
                                        >
                                            <span className="text-xs">{s.icon}</span>
                                            <span className="text-[10px] font-bold" style={{ color: s.color }}>
                                                {s.title}
                                            </span>
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </div>
                    
                    {/* 分離されたショートカットヒント兼アクションボタン */}
                    <div className="bg-slate-800/95 backdrop-blur-sm text-slate-200 px-3 py-2 rounded-lg shadow-lg border border-slate-700 text-[10px] flex gap-4 justify-between min-w-[200px]">
                        <div className="flex gap-2">
                            <div className="flex flex-col gap-1 items-center">
                                <span className="text-slate-400">コピー:</span>
                                <button onClick={handleActionCopy} className="font-mono text-[9px] bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 hover:bg-slate-700 hover:text-white transition cursor-pointer">Ctrl+C</button>
                            </div>
                            <div className="flex flex-col gap-1 items-center">
                                <span className="text-slate-400">カット:</span>
                                <button onClick={handleActionCut} className="font-mono text-[9px] bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 hover:bg-slate-700 hover:text-white transition cursor-pointer">Ctrl+X</button>
                            </div>
                            <div className="flex flex-col gap-1 items-center">
                                <span className="text-slate-400">ペースト:</span>
                                <button onClick={handleActionPaste} className={`font-mono text-[9px] bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 transition ${clipboard?.data?.length > 0 ? 'hover:bg-slate-700 hover:text-white cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>Ctrl+V</button>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1 items-center border-l border-slate-600 pl-4">
                            <span className="text-slate-400">一括削除:</span>
                            <button onClick={handleActionDelete} className="font-mono text-[9px] bg-red-900/50 text-red-200 border border-red-800 rounded px-1.5 py-0.5 hover:bg-red-800 hover:text-white transition cursor-pointer">Delete</button>
                        </div>
                    </div>
                    </div>
                )}

                {/* 会社行事・休日編集ポップアップ */}
                {editHolidayCell && (
                    <div
                        className="absolute z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-56 overflow-hidden"
                        style={{
                            top: `${editHolidayCell.top + 4}px`,
                            left: `${Math.max(0, editHolidayCell.left - 50)}px`
                        }}
                    >
                        <div className="bg-slate-700 text-white px-3 py-2 flex items-center justify-between">
                            <div className="text-xs font-bold">
                                {editHolidayCell.dateStr.slice(5).replace('-', '/')} の予定
                            </div>
                            <button
                                onClick={() => setEditHolidayCell(null)}
                                className="p-0.5 hover:bg-slate-600 rounded transition"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <div className="p-2 flex flex-col gap-1">
                            <button
                                onClick={() => updateCompanyHoliday(editHolidayCell.dateStr, '休日', editHolidayCell.existingId)}
                                className="text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded font-bold"
                            >
                                休日
                            </button>
                            <button
                                onClick={() => updateCompanyHoliday(editHolidayCell.dateStr, '会議', editHolidayCell.existingId)}
                                className="text-left px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 rounded font-bold"
                            >
                                会議
                            </button>
                            <button
                                onClick={() => updateCompanyHoliday(editHolidayCell.dateStr, '社員旅行', editHolidayCell.existingId)}
                                className="text-left px-3 py-2 text-sm text-violet-700 hover:bg-violet-50 rounded font-bold"
                            >
                                社員旅行
                            </button>

                            {editHolidayCell.existingId && (
                                <>
                                    <div className="border-t border-slate-100 my-1"></div>
                                    <button
                                        onClick={() => updateCompanyHoliday(editHolidayCell.dateStr, null, editHolidayCell.existingId)}
                                        className="text-left px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded"
                                    >
                                        予定を解除 (通常営業日)
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* 現場名ホバー時のツールチップ */}
            {hoverProjectStats && (
                <div 
                    className="fixed z-50 bg-slate-800 text-white rounded-lg shadow-xl p-3 w-56 text-xs pointer-events-none transform -translate-y-1/2"
                    style={{ top: hoverProjectStats.top + 16, left: hoverProjectStats.left + 5 }}
                >
                    <div className="font-bold text-sm mb-2 text-blue-200 border-b border-slate-600 pb-1">{hoverProjectStats.data.siteName}</div>
                    <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">担当職長:</span>
                            <span className="font-bold truncate max-w-[100px] text-right">{hoverProjectStats.foremanName}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">進捗状況:</span>
                            <span className="font-bold text-blue-300">{hoverProjectStats.data.overallProgress}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">消化工数:</span>
                            <span className="font-bold">{hoverProjectStats.data.totalActual}h / {hoverProjectStats.data.totalTarget}h</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">予測粗利:</span>
                            <span className={`font-bold ${hoverProjectStats.data.predictedProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ¥{Math.abs(Math.round(hoverProjectStats.data.predictedProfitLoss || 0)).toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
};

export default React.memo(AssignmentChartTab);


