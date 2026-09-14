import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useCustomerSettingsData() {
    const [customers, setCustomers] = useState([]);
    const [staffList, setStaffList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const refetch = useCallback(async () => {
        setIsLoading(true);
        try {
            const [{ data: cData, error: cErr }, { data: sData, error: sErr }] = await Promise.all([
                supabase.from('Customers').select('*').order('name', { ascending: true }),
                supabase.from('office_staff').select('id, name').order('name', { ascending: true }),
            ]);

            if (cErr) throw cErr;
            if (sErr) throw sErr;
            setCustomers(cData || []);
            setStaffList(sData || []);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const createCustomer = useCallback(async (payload) => {
        const { error } = await supabase.from('Customers').insert([payload]);
        if (error) throw error;
    }, []);

    const updateCustomer = useCallback(async (id, payload) => {
        const { error } = await supabase.from('Customers').update(payload).eq('id', id);
        if (error) throw error;
    }, []);

    const deleteCustomer = useCallback(async (id) => {
        const { error } = await supabase.from('Customers').delete().eq('id', id);
        if (error) throw error;
    }, []);

    return { customers, staffList, isLoading, refetch, createCustomer, updateCustomer, deleteCustomer };
}
