import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr, addDays } from '../utils/dateUtils';
import { DEFAULT_COLORS } from '../utils/constants';

export function useScheduleViewData(startDate, totalDays = 14) {
    const [isLoading, setIsLoading] = useState(true);
    const [workers, setWorkers] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [barProjects, setBarProjects] = useState([]);

    const refetch = useCallback(async () => {
        setIsLoading(true);
        try {
            const startStr = toDateStr(startDate);
            const endStr = toDateStr(addDays(startDate, totalDays - 1));

            const [aRes, pRes, wRes] = await Promise.all([
                supabase.from('Assignments').select('*').gte('date', startStr).lte('date', endStr),
                supabase.from('Projects').select('id, name, startDate, endDate, bar_color, status')
                    .not('startDate', 'is', null).not('endDate', 'is', null)
                    .order('created_at', { ascending: true }),
                // viewer/workerロールはWorkers基表を直接読めない（機微カラム遮蔽）ため安全カラムのみのビューを使う
                supabase.from('workers_directory').select('id, name, display_order, show_in_assignment')
                    .order('display_order', { ascending: true, nullsFirst: false })
            ]);

            setAssignments(aRes.data || []);
            setBarProjects((pRes.data || []).map((p, idx) => ({
                ...p,
                color: p.bar_color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            })));
            setWorkers((wRes.data || []).filter(w => w.name && w.name.trim() !== '' && w.show_in_assignment !== false));
        } catch (e) {
            console.error('データ取得エラー:', e);
        } finally {
            setIsLoading(false);
        }
    }, [startDate, totalDays]);

    useEffect(() => { refetch(); }, [refetch]);

    return { workers, assignments, barProjects, isLoading, refetch };
}
