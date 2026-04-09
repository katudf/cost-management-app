import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function useWorkers({ workers, setWorkers, showToast }) {
    const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);
    const [editingWorker, setEditingWorker] = useState(null);
    const [focusedWorkerRow, setFocusedWorkerRow] = useState(null);
    const [exportModalWorker, setExportModalWorker] = useState(null);

    const addWorker = () => {
        setEditingWorker({
            name: '', kana: '', birthDate: '', hireDate: '', address: '', contactInfo: '', cpdsNumber: ''
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
                cpdsNumber: editingWorker.cpdsNumber || null
            };

            if (editingWorker.id) {
                const { error } = await supabase.from('Workers').update(workerDataToSave).eq('id', editingWorker.id);
                if (error) throw error;
                setWorkers(prev => prev.map(w => w.id === editingWorker.id ? { ...w, ...workerDataToSave } : w));
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
        if (!window.confirm(`「${workerName}」を削除しますか？\n（※過去の実績データから名前は消えませんが、ログイン画面等の選択肢からは消去されます）`)) return;

        const { error } = await supabase.from('Workers').delete().eq('id', workerId);
        if (error) {
            console.error(error);
            showToast("作業員の削除に失敗しました。", 'error');
            return;
        }

        setWorkers(prev => prev.filter(w => w.id !== workerId));
    };

    const handleWorkerReorder = async (draggedId, targetId) => {
        if (draggedId === targetId) return;

        setWorkers(prev => {
            const dragIdx = prev.findIndex(w => w.id === draggedId);
            const targetIdx = prev.findIndex(w => w.id === targetId);
            if (dragIdx === -1 || targetIdx === -1) return prev;

            const next = [...prev];
            const [draggedItem] = next.splice(dragIdx, 1);
            next.splice(targetIdx, 0, draggedItem);

            // 並び順(display_order)を再計算
            const updatedWorkers = next.map((w, idx) => ({ ...w, display_order: idx + 1 }));

            // DB一括更新(非同期)
            Promise.all(
                updatedWorkers.map(w => supabase.from('Workers').update({ display_order: w.display_order }).eq('id', w.id))
            ).catch(err => {
                console.error('作業員並び順更新エラー:', err);
                showToast("並び順の保存に失敗しました", "error");
            });

            return updatedWorkers;
        });
    };

    return {
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
        handleWorkerReorder
    };
}
