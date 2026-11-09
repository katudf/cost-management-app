import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../components/ConfirmProvider';
import { WORKER_TYPE } from '../utils/constants';
import { syncWorkerBan, deleteWorkerWithLogin } from './useWorkerLogins';

export function useWorkers({ workers, setWorkers, showToast }) {
    const { confirm } = useConfirm();
    const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);
    const [editingWorker, setEditingWorker] = useState(null);
    const [focusedWorkerRow, setFocusedWorkerRow] = useState(null);
    const [exportModalWorker, setExportModalWorker] = useState(null);

    const addWorker = () => {
        setEditingWorker({
            name: '', kana: '', birthDate: '', hireDate: '', address: '', contactInfo: '', cpdsNumber: '', worker_type: WORKER_TYPE.WORKER, show_in_assignment: true
        });
        setIsWorkerModalOpen(true);
    };

    const openEditWorkerModal = (worker) => {
        setEditingWorker({ ...worker });
        setIsWorkerModalOpen(true);
    };

    const saveWorker = async () => {
        if (!editingWorker.name || editingWorker.name.trim() === '') {
            showToast('名前は必須です。', 'error');
            return;
        }

        try {
            const workerDataToSave = {
                name: editingWorker.name.trim(),
                kana: editingWorker.kana || null,
                birthDate: editingWorker.birthDate || null,
                hireDate: editingWorker.hireDate || null,
                resignation_date: editingWorker.resignation_date || null,
                address: editingWorker.address || null,
                contactInfo: editingWorker.contactInfo || null,
                cpdsNumber: editingWorker.cpdsNumber || null,
                worker_type: editingWorker.worker_type || WORKER_TYPE.WORKER
            };

            if (editingWorker.id) {
                const before = workers.find(w => w.id === editingWorker.id);
                const { error } = await supabase.from('Workers').update(workerDataToSave).eq('id', editingWorker.id);
                if (error) throw error;
                setWorkers(prev => prev.map(w => w.id === editingWorker.id ? { ...w, ...workerDataToSave } : w));
                // ログインのある作業員の退職日を変えたら、ログインの停止・再開を揃える
                // （docs/specs/worker-login.md 決定 #8。権限そのものは DB 側の退職日の判定で既に無くなっている）
                if (before?.auth_user_id && (before.resignation_date || null) !== workerDataToSave.resignation_date) {
                    try {
                        await syncWorkerBan(editingWorker.id);
                    } catch (banError) {
                        console.error('ログインの停止・再開に失敗しました:', banError);
                        showToast(
                            workerDataToSave.resignation_date
                                ? `退職日は保存しましたが、ログインの停止に失敗しました（作業員としての権限は既にありません）。もう一度保存してください: ${banError.message}`
                                : `退職日を消しましたが、ログインの再開に失敗しました。もう一度保存してください: ${banError.message}`,
                            'error',
                        );
                    }
                }
            } else {
                const maxOrder = workers.length > 0 ? Math.max(...workers.map(w => w.display_order || 0)) : 0;
                const { data, error } = await supabase.from('Workers').insert([{
                    ...workerDataToSave,
                    display_order: maxOrder + 1
                }]).select();
                if (error) throw error;
                setWorkers(prev => [...prev, data[0]]);
            }

            setIsWorkerModalOpen(false);
            setEditingWorker(null);
        } catch (error) {
            console.error(error);
            showToast('作業員の保存に失敗しました。', 'error');
        }
    };

    const removeWorker = async (workerId, workerName) => {
        const target = workers.find(w => w.id === workerId);
        const ok = await confirm({
            title: '作業員の削除',
            message: `「${workerName}」を削除しますか？\n（※過去の実績データから名前は消えませんが、ログイン画面等の選択肢からは消去されます）`
                + (target?.auth_user_id
                    ? '\n※この作業員のログインIDも削除され、ログインできなくなります（担当者と共有のIDは、担当者としては使えます）。元に戻せません。'
                    : ''),
            confirmText: '削除する',
        });
        if (!ok) return;

        // ログインのある作業員は Auth ユーザーも一緒に消すため Edge Function 経由にする（DB のトリガーが直接の削除を拒否する）
        if (target?.auth_user_id) {
            try {
                await deleteWorkerWithLogin(workerId);
            } catch (deleteError) {
                console.error(deleteError);
                showToast(`作業員の削除に失敗しました: ${deleteError.message}`, 'error');
                return;
            }
        } else {
            const { error } = await supabase.from('Workers').delete().eq('id', workerId);
            if (error) {
                console.error(error);
                showToast("作業員の削除に失敗しました。", 'error');
                return;
            }
        }

        setWorkers(prev => prev.filter(w => w.id !== workerId));
    };

    const handleWorkerReorder = async (draggedId, targetId) => {
        if (draggedId === targetId) return;

        // 1. ローカルでの並び順計算（Optimistic UI）
        const dragIdx = workers.findIndex(w => w.id === draggedId);
        const targetIdx = workers.findIndex(w => w.id === targetId);
        if (dragIdx === -1 || targetIdx === -1) return;

        const next = [...workers];
        const [draggedItem] = next.splice(dragIdx, 1);
        next.splice(targetIdx, 0, draggedItem);

        // 並び順(display_order)を仮に振り直す
        const updatedWorkers = next.map((w, idx) => ({ ...w, display_order: idx + 1 }));
        setWorkers(updatedWorkers);

        // 2. DB永続化
        try {
            // 一意制約（Unique Constraint）エラーを回避するため、現在の最大値を取得して
            // それより大きい値を一時的に割り当てる手法をとる
            const { data: maxData } = await supabase
                .from('Workers')
                .select('display_order')
                .not('display_order', 'is', null)
                .order('display_order', { ascending: false })
                .limit(1);
            
            const currentMax = maxData && maxData.length > 0 && maxData[0].display_order ? maxData[0].display_order : 0;
            
            // 全対象に対して「currentMax + インデックス」の新しい順序を振る
            // これにより、既存のどの display_order とも重複しなくなる
            const promises = updatedWorkers.map((w, idx) => 
                supabase.from('Workers').update({ display_order: currentMax + idx + 1 }).eq('id', w.id)
            );

            const results = await Promise.all(promises);
            const errors = results.filter(r => r.error);
            if (errors.length > 0) throw errors[0].error;

            // 成功した場合は、ローカルの状態も新しい display_order に合わせておく（リロード時の整合性のため）
            setWorkers(prev => prev.map((w, idx) => {
                const found = updatedWorkers.find(uw => uw.id === w.id);
                return found ? { ...w, display_order: currentMax + idx + 1 } : w;
            }));

        } catch (err) {
            console.error('作業員並び順更新エラー:', err);
            showToast("並び順の保存に失敗しました", "error");
            // ロールバックの代わりにデータを再取得して整合性を保つのが安全
            // (fetchAllData などを呼ぶのが理想だが、ここでは最低限の通知にとどめる)
        }
    };

    // 配置表への表示・非表示を切り替える（楽観的更新、失敗時は元に戻す）
    const toggleWorkerAssignmentVisibility = async (workerId, show) => {
        setWorkers(prev => prev.map(w => w.id === workerId ? { ...w, show_in_assignment: show } : w));

        const { error } = await supabase.from('Workers').update({ show_in_assignment: show }).eq('id', workerId);
        if (error) {
            console.error(error);
            setWorkers(prev => prev.map(w => w.id === workerId ? { ...w, show_in_assignment: !show } : w));
            showToast('配置表の表示設定の保存に失敗しました。', 'error');
        }
    };

    // 作業員マスタでログインを発行・紐付け・解除したあとに、手元の一覧のログイン有無を合わせる
    // （削除・退職日の保存で Edge Function を通すかの判定に使う。実際の値はサーバーにしか無いので有無だけ）
    const markWorkerLoginLinked = (workerId, linked) => {
        setWorkers(prev => prev.map(w => w.id === workerId
            ? { ...w, auth_user_id: linked ? (w.auth_user_id || 'linked') : null }
            : w));
    };

    return {
        markWorkerLoginLinked,
        isWorkerModalOpen,
        setIsWorkerModalOpen,
        editingWorker,
        setEditingWorker,
        focusedWorkerRow,
        setFocusedWorkerRow,
        exportModalWorker,
        setExportModalWorker,
        addWorker,
        openEditWorkerModal,
        saveWorker,
        removeWorker,
        handleWorkerReorder,
        toggleWorkerAssignmentVisibility
    };
}
