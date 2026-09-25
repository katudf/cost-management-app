import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { fetchWithCache } from '../utils/offlineCache';
import { fetchCompanyHolidaysResult } from './useCompanyHolidays';
import { toDateStr, addDays, getMonday, buildDateColumns, buildWeekGroups } from '../utils/dateUtils';
import { DEFAULT_COLORS } from '../utils/constants';

// 作業員向け配置表（閲覧専用）の表示期間: 表示開始週の月曜から4週間（初期表示は今週）
const TOTAL_DAYS = 28;

// オフラインキャッシュは初期表示（今週〜）の期間だけに使う。
// 任意期間ごとにキーを分けると localStorage に際限なく溜まるため、
// 他の期間はキャッシュを介さず直接取得する（オフライン時は取得失敗トースト）。
const fetchMaybeCached = async (useCache, key, fetcher) => {
    if (useCache) return fetchWithCache(key, fetcher);
    const { data, error } = await fetcher();
    if (error) throw error;
    return { data, fromCache: false };
};

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
    const defaultStartStr = useMemo(() => toDateStr(getMonday(new Date())), []);
    const [startDate, setStartDate] = useState(() => getMonday(new Date()));
    const startStr = toDateStr(startDate);
    const endStr = toDateStr(addDays(startDate, TOTAL_DAYS - 1));
    const isDefaultPeriod = startStr === defaultStartStr;

    const movePeriod = useCallback((weeks) => setStartDate(prev => addDays(prev, weeks * 7)), []);
    const goToToday = useCallback(() => setStartDate(getMonday(new Date())), []);

    useEffect(() => {
        let cancelled = false;
        const fetchAll = async () => {
            setIsLoading(true);
            try {
                // 日報実績は本日までしか存在しない（期間全体が未来なら空になる）
                const actualEnd = todayStr < endStr ? todayStr : endStr;
                const [{ data: aData }, { data: hData }, { data: trData }] = await Promise.all([
                    fetchMaybeCached(isDefaultPeriod, 'worker-chart-assignments', () =>
                        supabase.from('Assignments').select('*').gte('date', startStr).lte('date', endStr)
                    ),
                    fetchWithCache('worker-chart-holidays', fetchCompanyHolidaysResult),
                    fetchMaybeCached(isDefaultPeriod, 'worker-chart-actuals', () =>
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
    }, [startStr, endStr, todayStr, isDefaultPeriod, showToast]);

    const dateColumns = useMemo(() => buildDateColumns(startDate, TOTAL_DAYS), [startDate]);
    const weekGroups = useMemo(() => buildWeekGroups(dateColumns), [dateColumns]);

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

    // ログイン中の作業員を最上部に固定（workers はWorkerApp側で退職者・配置表非表示を除外済み）
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
        movePeriod,
        goToToday,
        dateColumns,
        weekGroups,
        holidayMap,
        projectMap,
        assignmentLookup,
        taskRecordLookup,
        displayWorkers,
    };
}
