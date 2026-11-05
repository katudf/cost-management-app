import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr, addDays } from '../utils/dateUtils';
import { PROJECT_STATUS } from '../utils/constants';
import { buildBarIndexMap, projectColor } from '../utils/scheduleDisplay';
import { fetchPublicSchedule } from '../features/scheduleShare/scheduleShareApi';
import { fetchCompanyHolidays } from './useCompanyHolidays';

const PROJECT_COLUMNS = 'id, name, short_name, startDate, endDate, bar_color, status, display_order, created_at';

/**
 * ログインして閲覧する場合の取得。共有 RPC（get_public_schedule）と同じ範囲の現場を返す:
 * バー対象（予定・施工中）の現場と、表示期間の配置が参照する現場（日付が無くても名前を出すため）。
 * バーの並び位置 bar_index も RPC と同じ規則で付ける。
 */
async function fetchScheduleForStaff(startStr, endStr) {
    const throwIf = (res) => { if (res.error) throw res.error; return res.data || []; };
    const [aRes, pRes, wRes, hData] = await Promise.all([
        supabase.from('Assignments').select('*').gte('date', startStr).lte('date', endStr),
        supabase.from('Projects').select(PROJECT_COLUMNS)
            .in('status', [PROJECT_STATUS.SCHEDULED, PROJECT_STATUS.IN_PROGRESS]),
        // viewer/workerロールはWorkers基表を直接読めない（機微カラム遮蔽）ため安全カラムのみのビューを使う
        supabase.from('workers_directory').select('id, name, display_order, show_in_assignment, resignation_date')
            .order('display_order', { ascending: true, nullsFirst: false }),
        fetchCompanyHolidays({ from: startStr, to: endStr }),
    ]);
    const assignments = throwIf(aRes);
    const barCandidates = throwIf(pRes);
    const workers = throwIf(wRes);

    const known = new Set(barCandidates.map(p => p.id));
    const missingIds = [...new Set(assignments.map(a => a.projectId).filter(id => id != null && !known.has(id)))];
    let referenced = [];
    if (missingIds.length > 0) {
        referenced = throwIf(await supabase.from('Projects').select(PROJECT_COLUMNS).in('id', missingIds));
    }

    const barIndexById = buildBarIndexMap(barCandidates);
    const projects = [...barCandidates, ...referenced].map(p => ({ ...p, bar_index: barIndexById.get(p.id) ?? null }));
    return { assignments, projects, workers, holidays: hData || [] };
}

/**
 * 配置予定表の閲覧データ。
 * shareKey を渡すとログイン不要の共有RPC（get_public_schedule）経由で取得する。
 * error: null | 'invalid_key' | 'fetch_failed'
 * canFetch: 共有キーが無いときはログイン後に true にする（未ログインで取ると RLS で空になり、
 *           ログインしても取り直されないため）。
 */
export function useScheduleViewData(startDate, totalDays = 28, shareKey = null, canFetch = true) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [workers, setWorkers] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [barProjects, setBarProjects] = useState([]);
    const [holidays, setHolidays] = useState([]);
    // 期間を素早く送ったとき、先に投げた期間の応答が後から届いて表示を上書きしないよう、最新の要求だけを反映する
    const requestSeqRef = useRef(0);

    const refetch = useCallback(async () => {
        const seq = ++requestSeqRef.current;
        if (!canFetch) return;
        setIsLoading(true);
        try {
            const startStr = toDateStr(startDate);
            const endStr = toDateStr(addDays(startDate, totalDays - 1));

            let aData, pData, wData, hData;
            if (shareKey) {
                const data = await fetchPublicSchedule(shareKey, startStr, endStr);
                aData = data?.assignments || [];
                pData = data?.projects || [];
                // マイグレーション 20261105050000 適用前の RPC は bar_index を返さないので、画面側で同じ規則で付ける
                if (pData.some(p => !('bar_index' in p))) {
                    const barIndexById = buildBarIndexMap(pData);
                    pData = pData.map(p => ({ ...p, bar_index: barIndexById.get(p.id) ?? null }));
                }
                wData = data?.workers || [];
                hData = data?.holidays || [];
            } else {
                ({ assignments: aData, projects: pData, workers: wData, holidays: hData } =
                    await fetchScheduleForStaff(startStr, endStr));
            }
            if (seq !== requestSeqRef.current) return;

            setAssignments(aData);
            setHolidays(hData);
            setBarProjects(pData.map(p => ({ ...p, color: projectColor(p, p.bar_index) })));
            setWorkers(wData.filter(w => w.name && w.name.trim() !== '' && w.show_in_assignment !== false && !w.resignation_date));
            setError(null);
        } catch (e) {
            if (seq !== requestSeqRef.current) return;
            console.error('データ取得エラー:', e);
            setError(String(e?.message || '').includes('invalid share key') ? 'invalid_key' : 'fetch_failed');
        } finally {
            if (seq === requestSeqRef.current) setIsLoading(false);
        }
    }, [startDate, totalDays, shareKey, canFetch]);

    useEffect(() => { refetch(); }, [refetch]);

    return { workers, assignments, barProjects, holidays, isLoading, error, refetch };
}
