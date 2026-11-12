import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAllPages';

// マイグレーション（20261112000000）の適用前はテーブルが無い（42P01 / PGRST205）。その間は空のマスタとして動かす。
const isMissingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205';

/**
 * 下請け会社マスタ（Subcontractors）と、現場ごとの契約（SubcontractContracts）の読み書き。
 * docs/specs/subcontractors.md。UI から直接 supabase.from() を呼ばないため、ここに集約する。
 *
 * 契約・記録は現場の状態（projects）に載っているので、変更後はその現場の分だけ取り直す。
 * 暫定契約の自動作成・単価コピーは DB のトリガーが行うため、記録の追加・更新のあとも取り直しが必要。
 */
export function useSubcontractors({ setProjects, showToast, onWorkersChanged }) {
    const [subcontractors, setSubcontractors] = useState([]);
    const [isSubcontractorsLoading, setIsSubcontractorsLoading] = useState(false);

    const fetchSubcontractors = useCallback(async () => {
        if (!supabase) return;
        setIsSubcontractorsLoading(true);
        try {
            const { data, error } = await supabase.from('Subcontractors').select('*').order('id', { ascending: true });
            if (error && !isMissingTable(error)) throw error;
            setSubcontractors(data || []);
        } catch (e) {
            console.error('下請け会社の取得に失敗しました:', e);
            showToast?.('下請け会社の取得に失敗しました', 'error');
        } finally {
            setIsSubcontractorsLoading(false);
        }
    }, [showToast]);

    useEffect(() => { fetchSubcontractors(); }, [fetchSubcontractors]);

    // 会社マスタを変えると、同期トリガーが Workers 行（配置表用）も作る・更新する。作業員の一覧も取り直す。
    const addSubcontractor = useCallback(async ({ name, standardUnitPrice = 0 }) => {
        const trimmed = String(name || '').trim();
        if (!trimmed) {
            showToast?.('会社名を入力してください', 'error');
            return false;
        }
        const { data, error } = await supabase
            .from('Subcontractors')
            .insert([{ name: trimmed, standard_unit_price: Number(standardUnitPrice) || 0 }])
            .select();
        if (error) {
            console.error(error);
            const duplicated = error.code === '23505';
            showToast?.(duplicated ? '同じ会社が登録済みです（㈲・有限会社などの表記違いを含む）' : '下請け会社の追加に失敗しました: ' + error.message, 'error');
            return false;
        }
        setSubcontractors(prev => [...prev, data[0]]);
        await onWorkersChanged?.();
        return true;
    }, [showToast, onWorkersChanged]);

    const updateSubcontractor = useCallback(async (id, patch) => {
        const previous = subcontractors.find(s => s.id === id);
        setSubcontractors(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
        const { error } = await supabase.from('Subcontractors').update(patch).eq('id', id);
        if (error) {
            console.error(error);
            setSubcontractors(prev => prev.map(s => (s.id === id ? previous : s)));
            const duplicated = error.code === '23505';
            showToast?.(duplicated ? '同じ会社が登録済みです（表記違いを含む）' : '下請け会社の保存に失敗しました: ' + error.message, 'error');
            return false;
        }
        if ('name' in patch || 'show_in_assignment' in patch || 'active' in patch) await onWorkersChanged?.();
        return true;
    }, [subcontractors, showToast, onWorkersChanged]);

    // その現場の契約と協力業者記録を取り直して projects に反映する
    const refreshProjectSubcontracts = useCallback(async (projectId) => {
        const [{ data: contracts, error: cError }, { data: records, error: rError }] = await Promise.all([
            supabase.from('SubcontractContracts').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
            fetchAllPages(() => supabase.from('SubcontractorRecords').select('*').eq('project_id', projectId).order('id', { ascending: true })),
        ]);
        const error = cError || rError;
        if (error) {
            console.error('協力業者の契約の再取得に失敗しました:', error);
            showToast?.('協力業者の契約の再取得に失敗しました。画面を再読み込みしてください。', 'error');
            return;
        }
        setProjects(prev => prev.map(p => (
            p.id === projectId ? { ...p, subcontractContracts: contracts || [], subcontractors: records || [] } : p
        )));
    }, [setProjects, showToast]);

    const saveContract = useCallback(async (request, projectId, label) => {
        const { error } = await request;
        if (error) {
            console.error(label + 'に失敗しました:', error);
            const overlapped = error.message?.includes('subcontract_contracts_ukeoi_no_overlap');
            const duplicatedJoyo = error.message?.includes('subcontract_contracts_joyo_key');
            const message = overlapped
                ? '同じ会社の請負の期間が重なっています'
                : duplicatedJoyo ? 'この現場には、この会社の常用契約がすでにあります' : error.message;
            showToast?.(label + 'に失敗しました: ' + message, 'error');
            return false;
        }
        await refreshProjectSubcontracts(projectId);
        return true;
    }, [showToast, refreshProjectSubcontracts]);

    const addContract = useCallback((projectId, fields) =>
        saveContract(supabase.from('SubcontractContracts').insert([{ project_id: projectId, ...fields }]), projectId, '契約の追加'),
    [saveContract]);

    const updateContract = useCallback((contract, patch) =>
        saveContract(supabase.from('SubcontractContracts').update(patch).eq('id', contract.id), contract.project_id, '契約の保存'),
    [saveContract]);

    const deleteContract = useCallback((contract) =>
        saveContract(supabase.from('SubcontractContracts').delete().eq('id', contract.id), contract.project_id, '契約の削除'),
    [saveContract]);

    // 暫定契約の単価を確定し、その契約の単価 0 の記録にも反映する（DB の RPC が 1 トランザクションで行う）
    const confirmContract = useCallback(async (contract, unitPrice) => {
        const { data, error } = await supabase.rpc('confirm_subcontract_contract', {
            p_contract_id: contract.id,
            p_unit_price: Number(unitPrice),
        });
        if (error) {
            console.error(error);
            showToast?.('契約の確定に失敗しました: ' + error.message, 'error');
            return null;
        }
        await refreshProjectSubcontracts(contract.project_id);
        return data;
    }, [showToast, refreshProjectSubcontracts]);

    return {
        subcontractors,
        isSubcontractorsLoading,
        fetchSubcontractors,
        addSubcontractor,
        updateSubcontractor,
        refreshProjectSubcontracts,
        addContract,
        updateContract,
        deleteContract,
        confirmContract,
    };
}
