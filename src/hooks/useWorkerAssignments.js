import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { fetchWithCache } from '../utils/offlineCache';
import { toDateStr, addDays, getDayOfWeek, getMonday } from '../utils/dateUtils';
import { DEFAULT_COLORS } from '../utils/constants';

// 作業員向け配置表（閲覧専用）の表示期間: 今週月曜から4週間
const TOTAL_DAYS = 28;

/**
 * 作業員アプリ用の閲覧専用配置表データフック。
 * useAssignmentState（管理者用）から表示に必要な取得・整形のみを抜き出した軽量版。
 * workers / projects は WorkerApp が既に取得済みのものを受け取る。
 */
export function useWorkerAssignments({ workers, projects, loggedInWorker }) {
    const { showToast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [assignments, setAssignments] = useState([]);
    const [taskRecords, setTaskRecords] = useState([]);
    const [holidays, setHolidays] = useState([]);

    const todayStr = useMemo(() => toDateStr(new Date()), []);
    const startDate = useMemo(() => getMonday(new Date()), []);
    const startStr = toDateStr(startDate);
    const endStr = toDateStr(addDays(startDate, TOTAL_DAYS - 1));

    useEffect(() => {
        let cancelled = false;
        const fetchAll = async () => {
            setIsLoading(true);
            try {
                const actualEnd = todayStr < endStr ? todayStr : endStr;
                const [{ data: aData }, { data: hData }, { data: trData }] = await Promise.all([
                    fetchWithCache('worker-chart-assignments', () =>
                        supabase.from('Assignments').select('*').gte('date', startStr).lte('date', endStr)
                    ),
                    fetchWithCache('worker-chart-holidays', () =>
                        supabase.from('CompanyHolidays').select('id, date, description')
                    ),
                    fetchWithCache('worker-chart-actuals', () =>
                        supabase.from('TaskRecords').select('id, project_id, worker_name, date').gte('date', startStr).lte('date', actualEnd)
                    ),
                ]);
                if (cancelled) return;
                setAssignments(aData || []);
                setHolidays(hData || []);
                setTaskRecords(trData || []);
            } catch (error) {
                console.error('配置表データ取得エラー:', error);
                if (!cancelled) showToast('配置表データの取得に失敗しました', 'error');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchAll();
        return () => { cancelled = true; };
    }, [startStr, endStr, todayStr, showToast]);

    const dateColumns = useMemo(() => {
        return Array.from({ length: TOTAL_DAYS }, (_, i) => {
            const date = addDays(startDate, i);
            return {
                date,
                dateStr: toDateStr(date),
                day: date.getDate(),
                month: date.getMonth() + 1,
                dow: date.getDay(),
                dowLabel: getDayOfWeek(date),
            };
        });
    }, [startDate]);

    const weekGroups = useMemo(() => {
        const groups = [];
        for (let i = 0; i < dateColumns.length; i += 7) {
            const days = dateColumns.slice(i, i + 7);
            groups.push({ label: `${days[0].month}/${days[0].day}`, days });
        }
        return groups;
    }, [dateColumns]);

    const holidayMap = useMemo(() => {
        const map = {};
        holidays.forEach(h => { map[h.date] = h; });
        return map;
    }, [holidays]);

    const projectMap = useMemo(() => {
        const map = {};
        (projects || []).forEach((p, idx) => {
            map[p.id] = {
                name: p.name || '無題',
                color: p.bar_color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
            };
        });
        return map;
    }, [projects]);

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
        const sets = {};
        taskRecords.forEach(tr => {
            const wId = workerNameToId[tr.worker_name];
            if (!wId) return;
            const key = `${wId}_${tr.date}`;
            if (!sets[key]) sets[key] = new Set();
            sets[key].add(tr.project_id);
        });
        const lookup = {};
        Object.keys(sets).forEach(key => { lookup[key] = Array.from(sets[key]); });
        return lookup;
    }, [taskRecords, workers]);

    // ログイン中の作業員を最上部に固定（workers はWorkerApp側で退職者・事務職除外済み）
    const displayWorkers = useMemo(() => {
        const list = workers || [];
        if (!loggedInWorker) return list;
        const self = list.filter(w => w.id === loggedInWorker.id);
        const others = list.filter(w => w.id !== loggedInWorker.id);
        return [...self, ...others];
    }, [workers, loggedInWorker]);

    return {
        isLoading,
        todayStr,
        startStr,
        endStr,
        dateColumns,
        weekGroups,
        holidayMap,
        projectMap,
        assignmentLookup,
        taskRecordLookup,
        displayWorkers,
    };
}
