import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * 工事案件の休工期間（ProjectSuspensions）のCRUD。
 * projectId が変わると自動で再取得する。
 *
 * エラーは throw する（トースト通知は呼び出し側の責務）。
 * @param {number|string|null|undefined} projectId 対象の工事案件ID
 */
export function useProjectSuspensions(projectId) {
    const [suspensions, setSuspensions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const refetch = useCallback(async () => {
        if (!projectId) {
            setSuspensions([]);
            return;
        }
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('ProjectSuspensions')
                .select('*')
                .eq('project_id', projectId)
                .order('start_date', { ascending: true });
            if (error) throw error;
            setSuspensions(data || []);
        } catch (e) {
            console.error('休工期間取得エラー:', e);
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        refetch();
    }, [refetch]);

    const addSuspension = useCallback(async ({ start_date, end_date, reason }) => {
        const { error } = await supabase
            .from('ProjectSuspensions')
            .insert({
                project_id: projectId,
                start_date,
                end_date,
                reason: reason || ''
            });
        if (error) throw error;
        await refetch();
    }, [projectId, refetch]);

    const removeSuspension = useCallback(async (id) => {
        const { error } = await supabase
            .from('ProjectSuspensions')
            .delete()
            .eq('id', id);
        if (error) throw error;
        await refetch();
    }, [refetch]);

    return { suspensions, isLoading, refetch, addSuspension, removeSuspension };
}
