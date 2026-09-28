import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useStaffSettingsData() {
    const [staffList, setStaffList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const refetch = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('office_staff')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;
            setStaffList(data || []);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const createStaff = useCallback(async (payload) => {
        const { error } = await supabase.from('office_staff').insert([payload]);
        if (error) throw error;
    }, []);

    const updateStaff = useCallback(async (id, payload) => {
        const { error } = await supabase.from('office_staff').update(payload).eq('id', id);
        if (error) throw error;
    }, []);

    const deleteStaff = useCallback(async (id) => {
        // RLSで削除権限がない場合、PostgRESTはエラーを返さず0件削除のまま204を返す。
        // .select() で削除された行を受け取り、0件なら権限不足として明示的にエラーにする。
        const { data, error } = await supabase.from('office_staff').delete().eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error('削除する権限がないか、対象の担当者が見つかりません。');
        }
    }, []);

    const inviteStaff = useCallback(async (staffId, email) => {
        const { error } = await supabase.functions.invoke('invite-staff', {
            body: { staffId, email },
        });
        if (error) throw error;
    }, []);

    return { staffList, isLoading, refetch, createStaff, updateStaff, deleteStaff, inviteStaff };
}
