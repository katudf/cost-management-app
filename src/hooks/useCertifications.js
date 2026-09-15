import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * 資格まわり（CertificationNames / WorkerCertifications）のCRUD。
 *
 * - `certNames` は資格名マスター。取得は refetchCertNames() を呼び出し側で叩く。
 * - 作業員の資格（WorkerCertifications）は一覧を持たない。
 *   表示用データは useSupabaseData 経由の workers[].certifications を使うため、
 *   ここでは書き込みだけを提供する。
 *
 * エラーは throw する（トースト通知は呼び出し側の責務）。
 */
export function useCertifications() {
    const [certNames, setCertNames] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const refetchCertNames = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('CertificationNames')
                .select('*')
                .order('name', { ascending: true });
            if (error) throw error;
            setCertNames(data || []);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const createCertName = useCallback(async (name) => {
        const { error } = await supabase
            .from('CertificationNames')
            .insert([{ name }]);
        if (error) throw error;
    }, []);

    const createWorkerCertification = useCallback(async (payload) => {
        const { error } = await supabase
            .from('WorkerCertifications')
            .insert([payload]);
        if (error) throw error;
    }, []);

    const updateWorkerCertification = useCallback(async (id, payload) => {
        const { error } = await supabase
            .from('WorkerCertifications')
            .update(payload)
            .eq('id', id);
        if (error) throw error;
    }, []);

    const deleteWorkerCertification = useCallback(async (id) => {
        const { error } = await supabase
            .from('WorkerCertifications')
            .delete()
            .eq('id', id);
        if (error) throw error;
    }, []);

    return {
        certNames,
        isLoading,
        refetchCertNames,
        createCertName,
        createWorkerCertification,
        updateWorkerCertification,
        deleteWorkerCertification,
    };
}
