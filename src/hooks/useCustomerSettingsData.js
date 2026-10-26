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
                supabase.from('office_staff').select('id, name, role').order('name', { ascending: true }),
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

    // 顧客に紐付く工事案件・見積を取得（それぞれ先頭 limit 件の名称と総件数）
    // ゴミ箱（ソフト削除）の見積も外部キーで参照しているため含める
    const fetchLinkedRecords = useCallback(async (customerId, limit = 3) => {
        const [projectsRes, estimatesRes] = await Promise.all([
            supabase
                .from('Projects')
                .select('name', { count: 'exact' })
                .eq('customerId', customerId)
                .order('created_at', { ascending: false })
                .limit(limit),
            supabase
                .from('estimates')
                .select('title, deleted_at', { count: 'exact' })
                .eq('customer_id', customerId)
                .order('created_at', { ascending: false })
                .limit(limit),
        ]);
        if (projectsRes.error) throw projectsRes.error;
        if (estimatesRes.error) throw estimatesRes.error;
        return {
            projects: {
                names: (projectsRes.data || []).map(p => p.name || '（名称未設定）'),
                total: projectsRes.count ?? 0,
            },
            estimates: {
                names: (estimatesRes.data || []).map(e => `${e.title || '（件名未設定）'}${e.deleted_at ? '［ゴミ箱］' : ''}`),
                total: estimatesRes.count ?? 0,
            },
        };
    }, []);

    return { customers, staffList, isLoading, refetch, createCustomer, updateCustomer, deleteCustomer, fetchLinkedRecords };
}
