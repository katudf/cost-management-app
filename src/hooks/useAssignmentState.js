import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr, addDays, getDayOfWeek, getMonday } from '../utils/dateUtils';
import { DEFAULT_COLORS, PROJECT_STATUS, WORKER_TYPE } from '../utils/constants';

export function useAssignmentState({
    projects,
    workers,
    customers,
    setProjects,
    showToast,
    setActiveProjectId,
    setActiveTab,
    allProjectsSummary
}) {
    const [staticLoading, setStaticLoading] = useState(true);
    const [periodLoading, setPeriodLoading] = useState(true);
    const [assignments, setAssignments] = useState([]);
    const [taskRecords, setTaskRecords] = useState([]);
    const [barProjects, setBarProjects] = useState([]);
    const [companyHolidays, setCompanyHolidays] = useState([]);
    const [projectSuspensions, setProjectSuspensions] = useState([]);

    // 会社休日のセル編集ポップアップ
    const [editHolidayCell, setEditHolidayCell] = useState(null);
    // プロジェクトカラー編集ポップアップ
    const [editColorPopup, setEditColorPopup] = useState(null);
    // セル編集ポップアップ
    const [editCell, setEditCell] = useState(null);

    // ドラッグ選択
    const [isDragging, setIsDragging] = useState(false);
    const [dragWorkerId, setDragWorkerId] = useState(null); // ドラッグ開始位置の作業員（起点）
    const [dragWorkerIds, setDragWorkerIds] = useState([]); // 列方向（縦）選択中の作業員ID配列
    const [dragCells, setDragCells] = useState([]); // 選択中のdateStr配列
    const [dragSourceCell, setDragSourceCell] = useState(null); // ドラッグ開始セル
    const [dragDirection, setDragDirection] = useState(null); // 'row' | 'col' | null（未確定）
    const dragStartRef = useRef(null); // { workerId, dateStr } ドラッグ開始セル情報

    // ツールチップ表示用
    const [hoverProjectStats, setHoverProjectStats] = useState(null);
    // クリップボード (コピペ用)
    const [clipboard, setClipboard] = useState(null);
    const [draggingGantt, setDraggingGantt] = useState(null);

    // Undo履歴（配置の追加・削除・並替え操作の逆操作スタック）
    const [undoStack, setUndoStack] = useState([]);
    const undoingRef = useRef(false);

    const popupRef = useRef(null);
    const tableContainerRef = useRef(null);

    // 表示期間
    const [startDate, setStartDate] = useState(() => getMonday(new Date()));
    const totalDays = 56;

    const isLoading = staticLoading || periodLoading;

    // 退社済み・事務属性の作業員を除外
    const activeWorkers = useMemo(() => {
        return (workers || []).filter(w => !w.resignation_date && w.worker_type !== WORKER_TYPE.OFFICE);
    }, [workers]);

    // 顧客情報のMap
    const customerMap = useMemo(() => {
        const map = {};
        (customers || []).forEach(c => {
            map[c.id] = c.name;
        });
        return map;
    }, [customers]);

    // 今日の日付文字列
    const todayStr = useMemo(() => toDateStr(new Date()), []);

    // 会社休日の日付 → レコードのMap（セル描画時のO(N)走査を排除）
    const holidayMap = useMemo(() => {
        const map = {};
        companyHolidays.forEach(h => { map[h.date] = h; });
        return map;
    }, [companyHolidays]);

    // 休工期間の project_id → レコード配列のMap
    const suspensionsByProject = useMemo(() => {
        const map = {};
        projectSuspensions.forEach(s => {
            if (!map[s.project_id]) map[s.project_id] = [];
            map[s.project_id].push(s);
        });
        return map;
    }, [projectSuspensions]);

    // ===== 日付・稼働日数ロジック (休日考慮) =====
    const isHoliday = useCallback((dateObj) => {
        const dow = dateObj.getDay();
        if (dow === 0) return true; // 日曜は常に休み
        const h = holidayMap[toDateStr(dateObj)];
        return !!(h && h.description !== '会議' && h.description !== '社員旅行');
    }, [holidayMap]);

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

    // ===== データ取得 =====
    // 期間に依存しないマスタ系データ（案件バー・会社休日・休工期間）
    const fetchStaticData = useCallback(async () => {
        setStaticLoading(true);
        try {
            const [pRes, hRes] = await Promise.all([
                supabase
                    .from('Projects')
                    .select('id, name, startDate, endDate, bar_color, status, display_order, customerId, is_prime_contractor')
                    .in('status', [PROJECT_STATUS.SCHEDULED, PROJECT_STATUS.IN_PROGRESS])
                    .order('display_order', { ascending: true, nullsFirst: false })
                    .order('created_at', { ascending: true }),
                supabase
                    .from('CompanyHolidays')
                    .select('id, date, description')
            ]);

            const pData = pRes.data || [];
            const excludedNames = ["【会社】有給", "有給", "【有給】"];
            setBarProjects(pData
                .filter(p => !excludedNames.includes(p.name))
                .map((p, idx) => ({
                    ...p,
                    color: p.bar_color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
                }))
            );
            setCompanyHolidays(hRes.data || []);

            const projectIds = pData.map(p => p.id);
            if (projectIds.length > 0) {
                const { data: sData } = await supabase
                    .from('ProjectSuspensions')
                    .select('*')
                    .in('project_id', projectIds);
                setProjectSuspensions(sData || []);
            } else {
                setProjectSuspensions([]);
            }
        } catch (e) {
            console.error('配置表マスタデータ取得エラー:', e);
        } finally {
            setStaticLoading(false);
        }
    }, []);

    // 表示期間に依存するデータ（配置・日報実績）
    const fetchPeriodData = useCallback(async () => {
        setPeriodLoading(true);
        try {
            const startStr = toDateStr(startDate);
            const endStr = toDateStr(addDays(startDate, totalDays - 1));

            const assignmentsQuery = supabase
                .from('Assignments')
                .select('*')
                .gte('date', startStr)
                .lte('date', endStr);

            // 過去(今日含む)日付の日報実績を取得
            const pastEndStr = todayStr <= endStr ? todayStr : endStr;
            const taskRecordsQuery = todayStr >= startStr
                ? supabase
                    .from('TaskRecords')
                    .select('id, project_id, worker_name, date')
                    .gte('date', startStr)
                    .lte('date', pastEndStr)
                : Promise.resolve({ data: [] });

            const [aRes, trRes] = await Promise.all([assignmentsQuery, taskRecordsQuery]);
            setAssignments(aRes.data || []);
            setTaskRecords(trRes.data || []);
        } catch (e) {
            console.error('配置表データ取得エラー:', e);
        } finally {
            setPeriodLoading(false);
        }
    }, [startDate, todayStr]);

    // 全データの再取得（外部から呼ぶ用）
    const fetchAssignments = useCallback(async () => {
        await Promise.all([fetchStaticData(), fetchPeriodData()]);
    }, [fetchStaticData, fetchPeriodData]);

    useEffect(() => {
        fetchStaticData();
    }, [fetchStaticData]);

    useEffect(() => {
        fetchPeriodData();
    }, [fetchPeriodData]);

    // リアルタイム購読（マウント時に1回だけ）
    useEffect(() => {
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
    }, []);

    // ポップアップ外クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (popupRef.current && !popupRef.current.contains(e.target)) {
                setEditCell(null);
            }
            if (editColorPopup && !e.target.closest('.color-popup')) {
                setEditColorPopup(null);
            }
        };
        if (editCell) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [editCell, editColorPopup]);

    // ドラッグ中のmouseup（window全体）
    useEffect(() => {
        const handleMouseUp = () => {
            if (isDragging && dragWorkerId && dragSourceCell) {
                if (dragDirection === 'col' && dragWorkerIds.length > 0) {
                    // 列方向（縦）選択 → 複数作業員・単一日付
                    const dateStr = dragCells[0];
                    setEditCell({
                        workerId: dragWorkerIds[0],
                        workerIds: [...dragWorkerIds],
                        dateStr,
                        dragDates: null,
                        top: dragSourceCell.top,
                        left: dragSourceCell.left,
                        showAbove: dragSourceCell.showAbove
                    });
                } else if (dragCells.length > 0) {
                    // 行方向（横）選択 → 単一作業員・複数日付
                    const firstDateStr = dragCells[0];
                    setEditCell({
                        workerId: dragWorkerId,
                        workerIds: [dragWorkerId],
                        dateStr: firstDateStr,
                        dragDates: [...dragCells],
                        top: dragSourceCell.top,
                        left: dragSourceCell.left,
                        showAbove: dragSourceCell.showAbove
                    });
                }
            }
            setIsDragging(false);
            setDragDirection(null);
            dragStartRef.current = null;
        };

        if (isDragging) {
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [isDragging, dragCells, dragWorkerId, dragWorkerIds, dragDirection, dragSourceCell]);

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

                // Global Status Sync
                if (setProjects) {
                    setProjects(prev => prev.map(p =>
                        p.id === projectId ? { ...p, startDate: tempStartStr, endDate: tempEndStr } : p
                    ));
                }

                try {
                    const { error } = await supabase.from('Projects').update({ startDate: tempStartStr, endDate: tempEndStr }).eq('id', projectId);
                    if (error) throw error;
                    showToast('工期を更新しました', 'success');
                } catch (error) {
                    console.error('工期更新エラー:', error);
                    showToast('工期の更新に失敗しました', 'error');
                }
            } else {
                setEditColorPopup({
                    projectId: projectId,
                    top: e.clientY,
                    left: e.clientX
                });
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [draggingGantt, addWorkingDays, showToast, setProjects]);

    // prj map
    const projectMap = useMemo(() => {
        const barColorById = {};
        barProjects.forEach(bp => { barColorById[bp.id] = bp.color; });
        const map = {};
        projects.forEach((p, idx) => {
            map[p.id] = {
                name: p.siteName || '無題',
                color: barColorById[p.id] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            };
        });
        return map;
    }, [projects, barProjects]);

    const allProjects = useMemo(() => {
        const excludedNames = ["【会社】有給", "有給", "【有給】"];
        return projects
            .filter(p => (p.status === PROJECT_STATUS.SCHEDULED || p.status === PROJECT_STATUS.IN_PROGRESS) && !excludedNames.includes(p.siteName))
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
        const result = {};
        Object.keys(lookup).forEach(key => {
            result[key] = Array.from(lookup[key]);
        });
        return result;
    }, [taskRecords, workers]);

    // === Undo（元に戻す）機能 ===
    // entry: { label, undo: async () => Promise<void> }
    const pushUndo = useCallback((entry) => {
        if (undoingRef.current) return;
        setUndoStack(prev => [...prev.slice(-19), entry]); // 直近20件まで保持
    }, []);

    // 削除されたAssignmentsレコードをDBに再INSERTし、stateにも反映する（Undo用）
    const restoreAssignments = useCallback(async (records) => {
        if (!records || records.length === 0) return;
        const inserts = records.map(r => ({
            workerId: r.workerId,
            projectId: r.projectId,
            date: r.date,
            title: r.title,
            assignment_order: r.assignment_order
        }));
        const { data, error } = await supabase.from('Assignments').insert(inserts).select();
        if (error) throw error;
        if (data) {
            setAssignments(prev => [...prev, ...data]);
        }
    }, []);

    // 追加されたAssignmentsレコードをID指定でDBから削除し、stateにも反映する（Undo用）
    const deleteAssignmentsByIds = useCallback(async (ids) => {
        if (!ids || ids.length === 0) return;
        setAssignments(prev => prev.filter(a => !ids.includes(a.id)));
        const { error } = await supabase.from('Assignments').delete().in('id', ids);
        if (error) throw error;
    }, []);

    const undo = useCallback(async () => {
        if (undoStack.length === 0) return;
        const entry = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        undoingRef.current = true;
        try {
            await entry.undo();
            showToast(`「${entry.label}」を元に戻しました`, 'success');
        } catch (err) {
            console.error('Undo実行エラー:', err);
            showToast('元に戻す操作に失敗しました', 'error');
        } finally {
            undoingRef.current = false;
        }
    }, [undoStack, showToast]);

    // === キーボードとUIからのアクションハンドラ ===
    const handleActionDelete = useCallback(async () => {
        if (!editCell) return;
        const targetDates = editCell.dragDates || [editCell.dateStr];
        const targetWorkerIds = editCell.workerIds && editCell.workerIds.length > 0 ? editCell.workerIds : [editCell.workerId];
        const toDelete = [];
        targetWorkerIds.forEach(workerId => {
            targetDates.forEach(dateStr => {
                const existing = assignmentLookup[`${workerId}_${dateStr}`] || [];
                toDelete.push(...existing);
            });
        });
        if (toDelete.length === 0) return;

        const idsToDelete = toDelete.map(a => a.id);
        const deletedRecords = toDelete.map(a => ({ ...a }));
        setAssignments(prev => prev.filter(a => !idsToDelete.includes(a.id)));
        try {
            await supabase.from('Assignments').delete().in('id', idsToDelete);
            showToast(`${toDelete.length}件の配置を削除しました`, 'success');
            pushUndo({
                label: '配置の削除',
                undo: () => restoreAssignments(deletedRecords)
            });
        } catch (err) {
            console.error('一括削除エラー', err);
            showToast('削除に失敗しました', 'error');
        }
        setEditCell(null);
        setDragCells([]);
    }, [editCell, assignmentLookup, showToast, pushUndo, restoreAssignments]);

    const handleActionCopy = useCallback(() => {
        if (!editCell) return;
        const targetDates = editCell.dragDates || [editCell.dateStr];
        const targetWorkerIds = editCell.workerIds && editCell.workerIds.length > 0 ? editCell.workerIds : [editCell.workerId];
        const baseDate = new Date(targetDates[0]);
        const copiedData = [];

        targetWorkerIds.forEach((workerId, workerOffset) => {
            targetDates.forEach(dateStr => {
                const existing = assignmentLookup[`${workerId}_${dateStr}`] || [];
                const currentDate = new Date(dateStr);
                const dayOffset = Math.round((currentDate - baseDate) / (1000 * 60 * 60 * 24));

                existing.forEach(a => {
                    copiedData.push({
                        dayOffset,
                        workerOffset,
                        projectId: a.projectId,
                        title: a.title,
                        assignment_order: a.assignment_order
                    });
                });
            });
        });

        if (copiedData.length > 0) {
            setClipboard({ type: 'copy', data: copiedData });
            showToast(`選択範囲（${copiedData.length}件）をコピーしました`, 'success');
        }
    }, [editCell, assignmentLookup, showToast]);

    const handleActionCut = useCallback(async () => {
        if (!editCell) return;
        const targetDates = editCell.dragDates || [editCell.dateStr];
        const targetWorkerIds = editCell.workerIds && editCell.workerIds.length > 0 ? editCell.workerIds : [editCell.workerId];
        const baseDate = new Date(targetDates[0]);
        const copiedData = [];
        const toDelete = [];

        targetWorkerIds.forEach((workerId, workerOffset) => {
            targetDates.forEach(dateStr => {
                const existing = assignmentLookup[`${workerId}_${dateStr}`] || [];
                const currentDate = new Date(dateStr);
                const dayOffset = Math.round((currentDate - baseDate) / (1000 * 60 * 60 * 24));

                existing.forEach(a => {
                    copiedData.push({
                        dayOffset,
                        workerOffset,
                        projectId: a.projectId,
                        title: a.title,
                        assignment_order: a.assignment_order
                    });
                    toDelete.push(a);
                });
            });
        });

        if (copiedData.length > 0) {
            setClipboard({ type: 'cut', data: copiedData });

            const idsToDelete = toDelete.map(a => a.id);
            const deletedRecords = toDelete.map(a => ({ ...a }));
            setAssignments(prev => prev.filter(a => !idsToDelete.includes(a.id)));
            try {
                await supabase.from('Assignments').delete().in('id', idsToDelete);
                showToast(`${copiedData.length}件をカットしました`, 'success');
                pushUndo({
                    label: '配置のカット',
                    undo: () => restoreAssignments(deletedRecords)
                });
            } catch (err) {
                console.error('カットエラー', err);
            }
            setEditCell(null);
            setDragCells([]);
        }
    }, [editCell, assignmentLookup, showToast, pushUndo, restoreAssignments]);

    const handleActionPaste = useCallback(async () => {
        if (!editCell || !clipboard || !clipboard.data || clipboard.data.length === 0) return;

        const targetDates = editCell.dragDates || [editCell.dateStr];
        const targetWorkerIds = editCell.workerIds && editCell.workerIds.length > 0 ? editCell.workerIds : [editCell.workerId];
        const baseDateStr = targetDates[0];
        const baseDate = new Date(baseDateStr);

        const newRecords = [];
        const tempIds = [];

        const isSingleDayCopy = clipboard.data.every(item => item.dayOffset === 0);
        const isMultiDayPasteTarget = targetDates.length > 1;
        const isSingleWorkerCopy = clipboard.data.every(item => (item.workerOffset || 0) === 0);
        const isMultiWorkerPasteTarget = targetWorkerIds.length > 1;

        const pushRecord = (workerId, dateStr, item) => {
            const tempId = `temp-${Date.now()}-${Math.random()}`;
            tempIds.push(tempId);
            newRecords.push({
                id: tempId,
                workerId,
                projectId: item.projectId,
                date: dateStr,
                title: item.title,
                assignment_order: item.assignment_order
            });
        };

        if (isSingleWorkerCopy && isMultiWorkerPasteTarget) {
            // 列方向（縦）貼り付け：単一日付・複数作業員へ展開
            const dateStr = targetDates[0];
            targetWorkerIds.forEach(wId => {
                clipboard.data.forEach(item => pushRecord(wId, dateStr, item));
            });
        } else if (isSingleDayCopy && isMultiDayPasteTarget) {
            const workerId = targetWorkerIds[0];
            targetDates.forEach(tDateStr => {
                clipboard.data.forEach(item => pushRecord(workerId, tDateStr, item));
            });
        } else {
            const workerId = targetWorkerIds[0];
            clipboard.data.forEach(item => {
                const targetDate = new Date(baseDate);
                targetDate.setDate(targetDate.getDate() + item.dayOffset);
                const targetDateStr = targetDate.toISOString().split('T')[0];
                pushRecord(workerId, targetDateStr, item);
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
                const insertedIds = data.map(d => d.id);
                pushUndo({
                    label: '配置の貼り付け',
                    undo: () => deleteAssignmentsByIds(insertedIds)
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
    }, [editCell, clipboard, showToast, pushUndo, deleteAssignmentsByIds]);

    // キーボードショートカット（セル編集ポップアップ表示中のみ有効）
    useEffect(() => {
        if (!editCell) return;

        const handleKeyDown = (e) => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

            if (e.key === 'Escape') {
                setEditCell(null);
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                handleActionDelete();
                return;
            }
            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 'c') {
                    e.preventDefault();
                    handleActionCopy();
                } else if (key === 'x') {
                    e.preventDefault();
                    handleActionCut();
                } else if (key === 'v') {
                    e.preventDefault();
                    handleActionPaste();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editCell, handleActionDelete, handleActionCopy, handleActionCut, handleActionPaste]);

    // Ctrl+Z / Cmd+Z（セル編集ポップアップの表示有無に関わらずグローバルに有効）
    useEffect(() => {
        const handleUndoKeyDown = (e) => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undo();
            }
        };

        window.addEventListener('keydown', handleUndoKeyDown);
        return () => window.removeEventListener('keydown', handleUndoKeyDown);
    }, [undo]);

    // === 配置編集アクション ===

    const addAssignment = useCallback(async (workerId, dateStr, projectId, title = null) => {
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
                pushUndo({
                    label: '配置の追加',
                    undo: () => deleteAssignmentsByIds([data[0].id])
                });
            }
        } catch (e) {
            console.error('配置追加エラー:', e);
            setAssignments(prev => prev.filter(a => a.id !== tempId));
        }
    }, [assignmentLookup, pushUndo, deleteAssignmentsByIds]);

    const addAssignmentBatch = useCallback(async (workerId, dateStrs, projectId, title = null) => {
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

        setAssignments(prev => [...prev, ...newRecords]);

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
                const insertedIds = data.map(d => d.id);
                pushUndo({
                    label: '配置の一括追加',
                    undo: () => deleteAssignmentsByIds(insertedIds)
                });
            }
        } catch (e) {
            console.error('一括配置追加エラー:', e);
            setAssignments(prev => prev.filter(a => !tempIds.includes(a.id)));
            showToast('配置の追加に失敗しました。', 'error');
        }
    }, [assignmentLookup, showToast, pushUndo, deleteAssignmentsByIds]);

    const removeAssignment = useCallback(async (assignmentId) => {
        let removed = null;
        setAssignments(prev => {
            removed = prev.find(a => a.id === assignmentId) || null;
            return prev.filter(a => a.id !== assignmentId);
        });

        try {
            const { error } = await supabase
                .from('Assignments')
                .delete()
                .eq('id', assignmentId);

            if (error) throw error;
            if (removed) {
                const removedRecord = { ...removed };
                pushUndo({
                    label: '配置の削除',
                    undo: () => restoreAssignments([removedRecord])
                });
            }
        } catch (e) {
            console.error('配置削除エラー:', e);
            if (removed) setAssignments(prev => [...prev, removed]);
            showToast('配置の削除に失敗しました。', 'error');
        }
    }, [showToast, pushUndo, restoreAssignments]);

    const handleAssignmentReorder = useCallback(async (draggedId, targetId) => {
        if (!editCell) return;
        if (draggedId === targetId) return;

        const editCellAssignments = assignmentLookup[`${editCell.workerId}_${editCell.dateStr}`] || [];
        const items = [...editCellAssignments];
        const dragIdx = items.findIndex(a => a.id === draggedId);
        const targetIdx = items.findIndex(a => a.id === targetId);

        if (dragIdx === -1 || targetIdx === -1) return;

        const nextItems = [...items];
        const [draggedItem] = nextItems.splice(dragIdx, 1);
        nextItems.splice(targetIdx, 0, draggedItem);

        const updatedItems = nextItems.map((item, i) => ({ ...item, assignment_order: i + 1 }));

        setAssignments(prev => {
            const next = [...prev];
            updatedItems.forEach(updated => {
                const idx = next.findIndex(a => a.id === updated.id);
                if (idx !== -1) next[idx] = updated;
            });
            return next;
        });

        try {
            const promises = updatedItems.map(item =>
                supabase.from('Assignments').update({ assignment_order: item.assignment_order }).eq('id', item.id)
            );
            await Promise.all(promises);
        } catch (e) {
            console.error('順番変更エラー:', e);
            showToast('順番の変更に失敗しました。', 'error');
        }
    }, [editCell, assignmentLookup, showToast]);

    const handleProjectReorder = useCallback(async (draggedId, targetId) => {
        if (draggedId === targetId) return;

        setBarProjects(prev => {
            const dragIdx = prev.findIndex(p => p.id === draggedId);
            const targetIdx = prev.findIndex(p => p.id === targetId);
            if (dragIdx === -1 || targetIdx === -1) return prev;

            const next = [...prev];
            const [draggedItem] = next.splice(dragIdx, 1);
            next.splice(targetIdx, 0, draggedItem);

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
    }, [showToast]);

    const updateProjectColor = useCallback(async (projectId, color) => {
        setBarProjects(prev => prev.map(p => p.id === projectId ? { ...p, color } : p));
        if (setProjects) {
            setProjects(prev => prev.map(p => p.id === projectId ? { ...p, bar_color: color } : p));
        }

        try {
            const { error } = await supabase.from('Projects').update({ bar_color: color }).eq('id', projectId);
            if (error) throw error;
            showToast('配置表カラーを更新しました', 'success');
        } catch (e) {
            console.error('カラー更新エラー:', e);
            showToast('カラーの更新に失敗しました', 'error');
        }
        setEditColorPopup(null);
    }, [setProjects, showToast]);

    const updateCompanyHoliday = useCallback(async (dateStr, description, existingId) => {
        try {
            if (description === null && existingId) {
                const { error } = await supabase.from('CompanyHolidays').delete().eq('id', existingId);
                if (error) throw error;
                setCompanyHolidays(prev => prev.filter(h => h.id !== existingId));
                showToast('予定を削除しました', 'success');
            } else if (description !== null) {
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
    }, [showToast]);

    // === ドラッグハンドラ ===

    const handleCellMouseDown = useCallback((e, workerId, dateStr) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setEditCell(null);
        setEditHolidayCell(null);

        const cellRect = e.currentTarget.getBoundingClientRect();
        const containerRect = tableContainerRef.current?.getBoundingClientRect();
        const spaceBelow = window.innerHeight - cellRect.bottom;
        const showAbove = spaceBelow < 350;

        setIsDragging(true);
        setDragDirection(null);
        dragStartRef.current = { workerId, dateStr };
        setDragWorkerId(workerId);
        setDragWorkerIds([workerId]);
        setDragCells([dateStr]);
        setDragSourceCell({
            top: showAbove
                ? cellRect.top - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0)
                : cellRect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
            left: cellRect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0),
            showAbove
        });
    }, []);

    const handleCellMouseEnter = useCallback((workerId, dateStr) => {
        if (!isDragging || !dragStartRef.current) return;
        const { workerId: startWorkerId, dateStr: startDateStr } = dragStartRef.current;

        // 方向未確定の場合、移動先セルから行方向/列方向を判定する
        let direction = dragDirection;
        if (!direction) {
            if (workerId !== startWorkerId && dateStr === startDateStr) {
                direction = 'col';
                setDragDirection('col');
            } else if (dateStr !== startDateStr) {
                direction = 'row';
                setDragDirection('row');
            } else {
                return; // 起点セルのまま：方向未確定
            }
        }

        if (direction === 'row') {
            if (workerId !== startWorkerId) return;
            setDragCells(prev => {
                if (prev.length === 0) return [dateStr];
                if (prev[prev.length - 1] === dateStr) return prev;

                const startD = new Date(prev[0] + 'T00:00:00');
                const currentD = new Date(dateStr + 'T00:00:00');
                const step = startD <= currentD ? 1 : -1;

                const newCells = [];
                let tempD = new Date(startD);
                while (true) {
                    newCells.push(toDateStr(tempD));

                    if (tempD.getTime() === currentD.getTime()) break;
                    tempD.setDate(tempD.getDate() + step);
                }

                if (prev.length === newCells.length && prev.every((v, i) => v === newCells[i])) {
                    return prev;
                }
                return newCells;
            });
        } else {
            // 列方向（縦）：同一日付内で作業員範囲を拡張
            if (dateStr !== startDateStr) return;
            const startIdx = activeWorkers.findIndex(w => w.id === startWorkerId);
            const currentIdx = activeWorkers.findIndex(w => w.id === workerId);
            if (startIdx === -1 || currentIdx === -1) return;

            const lo = Math.min(startIdx, currentIdx);
            const hi = Math.max(startIdx, currentIdx);
            const newWorkerIds = activeWorkers.slice(lo, hi + 1).map(w => w.id);

            setDragWorkerIds(prev => {
                if (prev.length === newWorkerIds.length && prev.every((v, i) => v === newWorkerIds[i])) {
                    return prev;
                }
                return newWorkerIds;
            });
            setDragCells([startDateStr]);
        }
    }, [isDragging, dragDirection, activeWorkers]);

    const handleCellClick = useCallback((e, workerId, dateStr) => {
        setEditHolidayCell(null);
        if (isDragging) return;
        const cellRect = e.currentTarget.getBoundingClientRect();
        const containerRect = tableContainerRef.current?.getBoundingClientRect();
        const spaceBelow = window.innerHeight - cellRect.bottom;
        const showAbove = spaceBelow < 350;

        setEditCell({
            workerId,
            workerIds: [workerId],
            dateStr,
            dragDates: null,
            top: showAbove
                ? cellRect.top - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0)
                : cellRect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
            left: cellRect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0),
            showAbove
        });
    }, [isDragging]);

    const handleProjectNameMouseEnter = useCallback((e, project) => {
        if (!allProjectsSummary) return;
        const stats = allProjectsSummary.find(p => p.id === project.id);
        if (!stats) return;

        const rect = e.currentTarget.getBoundingClientRect();
        setHoverProjectStats({
            data: stats,
            foremanName: workers.find(w => w.id === stats.foreman_worker_id)?.name || '未設定',
            startDate: project.startDate,
            endDate: project.endDate,
            top: rect.top,
            left: rect.right
        });
    }, [allProjectsSummary, workers]);

    const handlePopupAssign = useCallback(async (projectId, title = null) => {
        if (!editCell) return;
        const dates = editCell.dragDates || [editCell.dateStr];
        const workerIds = editCell.workerIds && editCell.workerIds.length > 0 ? editCell.workerIds : [editCell.workerId];

        try {
            if (workerIds.length > 1) {
                // 列方向（縦）：単一日付・複数作業員へ展開
                await Promise.all(workerIds.map(wId => addAssignment(wId, dates[0], projectId, title)));
            } else if (dates.length <= 1) {
                await addAssignment(editCell.workerId, dates[0], projectId, title);
            } else {
                await addAssignmentBatch(editCell.workerId, dates, projectId, title);
            }
            setEditCell(null);
            setDragCells([]);
        } catch (e) {
            console.error('配置登録エラー:', e);
            showToast('配置登録中にエラーが発生しました。', 'error');
        }
    }, [editCell, addAssignment, addAssignmentBatch, showToast]);

    const movePeriod = useCallback((weeks) => {
        setEditCell(null);
        setStartDate(prev => addDays(prev, weeks * 7));
    }, []);

    const goToToday = useCallback(() => {
        setEditCell(null);
        setStartDate(getMonday(new Date()));
    }, []);

    const getBarSpan = useCallback((project) => {
        if (!project.startDate || !project.endDate) return null;
        const pStart = new Date(project.startDate + 'T00:00:00');
        const pEnd = new Date(project.endDate + 'T00:00:00');
        const viewStart = startDate;
        const viewEnd = addDays(startDate, totalDays - 1);

        if (pEnd < viewStart || pStart > viewEnd) return null;

        const startIdx = Math.max(0, Math.round((pStart - viewStart) / (1000 * 60 * 60 * 24)));
        const endIdx = Math.min(totalDays - 1, Math.round((pEnd - viewStart) / (1000 * 60 * 60 * 24)));

        return { startIdx, endIdx, span: endIdx - startIdx + 1 };
    }, [startDate]);

    return {
        isLoading,
        assignments,
        setAssignments,
        taskRecords,
        barProjects,
        setBarProjects,
        companyHolidays,
        holidayMap,
        projectSuspensions,
        suspensionsByProject,
        editHolidayCell,
        setEditHolidayCell,
        editColorPopup,
        setEditColorPopup,
        editCell,
        setEditCell,
        isDragging,
        dragWorkerId,
        dragWorkerIds,
        dragCells,
        hoverProjectStats,
        setHoverProjectStats,
        clipboard,
        draggingGantt,
        startDate,
        setStartDate,
        totalDays,
        activeWorkers,
        customerMap,
        dateColumns,
        weekGroups,
        todayStr,
        projectMap,
        allProjects,
        assignmentLookup,
        taskRecordLookup,
        isHoliday,
        countWorkingDays,
        addWorkingDays,
        fetchAssignments,
        handleGanttPointerDown,
        handleActionDelete,
        handleActionCopy,
        handleActionCut,
        handleActionPaste,
        addAssignment,
        addAssignmentBatch,
        removeAssignment,
        handleAssignmentReorder,
        handleProjectReorder,
        updateProjectColor,
        updateCompanyHoliday,
        handleCellMouseDown,
        handleCellMouseEnter,
        handleCellClick,
        handleProjectNameMouseEnter,
        handlePopupAssign,
        movePeriod,
        goToToday,
        getBarSpan,
        popupRef,
        tableContainerRef,
        undo,
        canUndo: undoStack.length > 0
    };
}
