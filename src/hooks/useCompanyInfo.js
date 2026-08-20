import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const COMPANY_FIELDS = 'company_name, company_zip, company_address, company_tel, company_fax';

/**
 * 自社情報（system_settings の id=1 固定行）を取得する。
 * @param {string} columns 取得したいカラム（既定は自社情報の基本項目すべて）
 */
export function useCompanyInfo(columns = COMPANY_FIELDS) {
    const [companyInfo, setCompanyInfo] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const fetchCompanyInfo = async () => {
            try {
                const { data, error } = await supabase
                    .from('system_settings')
                    .select(columns)
                    .eq('id', 1)
                    .single();
                if (error) throw error;
                if (!cancelled) setCompanyInfo(data || null);
            } catch (e) {
                console.error('自社情報取得エラー:', e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchCompanyInfo();
        return () => { cancelled = true; };
    }, [columns]);

    return { companyInfo, isLoading };
}
