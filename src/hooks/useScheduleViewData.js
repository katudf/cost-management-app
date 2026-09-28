import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr, addDays } from '../utils/dateUtils';
import { DEFAULT_COLORS } from '../utils/constants';
import { fetchPublicSchedule } from '../features/scheduleShare/scheduleShareApi';
import { fetchCompanyHolidays } from './useCompanyHolidays';

/**
 * 配置予定表の閲覧データ。
 * shareKey を渡すとログイン不要の共有RPC（get_public_schedule）経由で取得する。
 * error: null | 'invalid_key' | 'fetch_failed'
 */
export function useScheduleViewData(startDate, totalDays = 14, shareKey = null) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [workers, setWorkers] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [barProjects, setBarProjects] = useState([]);
    const [holidays, setHolidays] = useState([]);

    const refetch = useCallback(async () => {
        setIsLoading(true);
        try {
            const startStr = toDateStr(startDate);
            const endStr = toDateStr(addDays(startDate, totalDays - 1));

            let aData, pData, wData, hData;
            if (shareKey) {
                const data = await fetchPublicSchedule(shareKey, startStr, endStr);
                aData = data?.assignments || [];
                pData = data?.projects || [];
                wData = data?.workers || [];
                hData = data?.holidays || [];
            } else {
                const [aRes, pRes, wRes, holidayRows] = await Promise.all([
                    supabase.from('Assignments').select('*').gte('date', startStr).lte('date', endStr),
                    supabase.from('Projects').select('id, name, short_name, startDate, endDate, bar_color, status, display_order')
                        .not('startDate', 'is', null).not('endDate', 'is', null)
                        .order('display_order', { ascending: true, nullsFirst: false })
                        .order('created_at', { ascending: true }),
                    // viewer/workerロールはWorkers基表を直接読めない（機微カラム遮蔽）ため安全カラムのみのビューを使う
                    supabase.from('workers_directory').select('id, name, display_order, show_in_assignment, resignation_date')
                        .order('display_order', { ascending: true, nullsFirst: false }),
                    fetchCompanyHolidays({ from: startStr, to: endStr })
                ]);
                aData = aRes.data || [];
                pData = pRes.data || [];
                wData = wRes.data || [];
                hData = holidayRows;
            }

            setAssignments(aData);
            setHolidays(hData);
            setBarProjects(pData.map((p, idx) => ({
                ...p,
                color: p.bar_color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            })));
            setWorkers(wData.filter(w => w.name && w.name.trim() !== '' && w.show_in_assignment !== false && !w.resignation_date));
            setError(null);
        } catch (e) {
            console.error('データ取得エラー:', e);
            setError(String(e?.message || '').includes('invalid share key') ? 'invalid_key' : 'fetch_failed');
        } finally {
            setIsLoading(false);
        }
    }, [startDate, totalDays, shareKey]);

    useEffect(() => { refetch(); }, [refetch]);

    return { workers, assignments, barProjects, holidays, isLoading, error, refetch };
}
