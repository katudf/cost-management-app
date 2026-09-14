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
        const { error } = await supabase.from('office_staff').delete().eq('id', id);
        if (error) throw error;
    }, []);

    const inviteStaff = useCallback(async (staffId, email) => {
        const { error } = await supabase.functions.invoke('invite-staff', {
            body: { staffId, email },
        });
        if (error) throw error;
    }, []);

    return { staffList, isLoading, refetch, createStaff, updateStaff, deleteStaff, inviteStaff };
}
