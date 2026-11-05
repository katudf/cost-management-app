import { useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { PROJECT_STATUS } from '../utils/constants';
import { toDateStr } from '../utils/dateUtils';
import { importProjectCore, rollbackImport } from '../utils/projectExcelImport';
import { useConfirm } from '../components/ConfirmProvider';
import {
    getNextEstimateSeq, findAvailableBranchNumber, createEstimate, updateEstimate, deleteEstimate,
    buildSaveItemsPayload, saveEstimateItemsV2, syncEstimateToProject, copyEstimateItemsToProjectTasks,
    calcTopSheetTotals,
} from '../supabaseEstimates';

export function useProjects({ projects, setProjects, activeProjectId, setActiveProjectId, showToast, workers, setActiveTab }) {
    const { confirm } = useConfirm();
    // fallbackOrder が常に最新の projects を参照するための ref
    const projectsRef = useRef(projects);
    projectsRef.current = projects;

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);

    const activeProject = useMemo(() => {
        return projects.find(p => p.id === activeProjectId) || projects[0] || {
            id: 'loading', siteName: '読込中...', masterData: [], records: [], progressData: {}
        };
    }, [projects, activeProjectId]);

    const updateLayer = useCallback((updater) => {
        setProjects(prev => prev.map(p =>
            p.id === activeProjectId ? { ...p, ...updater(p) } : p
        ));
    }, [activeProjectId, setProjects]);

    // 指定の現場だけを書き換える（画面を先に書き換えたあと、保存に失敗したら元に戻すのに使う）
    const patchProject = useCallback((id, patch) => {
        setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
    }, [setProjects]);

    /**
     * 画面を先に書き換えた更新の保存結果を確かめる。
     * 失敗したら rollback で画面を元に戻し、トーストで知らせる（以前は失敗しても画面は成功したように見えた）。
     * @returns {Promise<boolean>} 保存できたら true
     */
    const confirmSaved = useCallback(async (request, label, rollback) => {
        const { error } = await request;
        if (!error) return true;
        console.error(label + 'に失敗しました:', error);
        if (rollback) rollback();
        showToast(label + 'に失敗しました: ' + error.message, 'error');
        return false;
    }, [showToast]);

    const addNewProject = async () => {
        if (projects.some(p => p.siteName === '')) {
            showToast('まだ名前が設定されていない新規現場があります。先に名前を設定してください。', 'error');
            return;
        }
        const nextOrder = projects.length > 0 ? Math.max(...projects.map(p => p.order || 0)) + 1 : 0;
        const tempName = `__NEW_PROJECT__${Date.now()}`;
        const { data, error } = await supabase.from('Projects').insert([{ name: tempName, order: nextOrder, status: PROJECT_STATUS.ESTIMATE, show_on_home: true }]).select();
        if (error) {
            console.error(error); showToast('現場の作成に失敗しました: ' + error.message, 'error');
            return;
        }
        const newProj = data[0];

        setProjects(prev => [...prev, {
            id: newProj.id, order: newProj.order, siteName: '', status: newProj.status || PROJECT_STATUS.ESTIMATE, show_on_home: true, masterData: [], records: [], progressData: {}
        }]);
        setActiveProjectId(newProj.id);
    };

    // Excelから取り込み: 下書き見積 + 予定ステータスの現場を作成する（中核は utils/projectExcelImport.js）
    // 戻り値: 作成した Projects.id（失敗時は null）
    const importProjectFromExcel = async ({ parsed, fileName, customerId, projectName }) => {
        const deps = {
            getNextEstimateSeq, findAvailableBranchNumber, createEstimate, updateEstimate, deleteEstimate,
            buildSaveItemsPayload, saveEstimateItemsV2, syncEstimateToProject, copyEstimateItemsToProjectTasks,
            calcTopSheetTotals,
            fetchProjectOrder: async (id) => {
                const { data, error } = await supabase.from('Projects').select('order').eq('id', id).single();
                if (error) throw error;
                return data?.order ?? null;
            },
            fallbackOrder: () => {
                const list = projectsRef.current;
                return list.length > 0 ? Math.max(...list.map(p => p.order || 0)) + 1 : 0;
            },
            deleteProjectTasks: (id) => supabase.from('ProjectTasks').delete().eq('projectId', id),
            deleteProject: (id) => supabase.from('Projects').delete().eq('id', id),
        };
        try {
            const { projectId, project } = await importProjectCore(deps, { parsed, fileName, customerId, projectName });
            setProjects(prev => [...prev, project]);
            setActiveProjectId(projectId);
            showToast(`「${project.siteName}」を取り込みました（下書き見積を作成）`, 'success');
            return projectId;
        } catch (e) {
            console.error('Excel取り込みエラー:', e);
            const rollbackErrors = await rollbackImport(deps, e.createdIds || {});
            if (rollbackErrors.length > 0) {
                console.error('Excel取り込みロールバック失敗:', rollbackErrors);
                showToast('取り込みに失敗し、一部のデータを元に戻せませんでした（' + rollbackErrors.join(' / ') + '）。管理者に確認してください', 'error');
                return null;
            }
            showToast('取り込みに失敗しました: ' + (e.message || e), 'error');
            return null;
        }
    };

    const removeProject = (id) => {
        if (projects.length <= 1) {
            showToast("最後の現場は削除できません！", 'error');
            return;
        }
        setPendingDeleteId(id);
        setIsDeleteModalOpen(true);
    };

    const confirmRemoveProject = async () => {
        if (!pendingDeleteId) return;
        const id = pendingDeleteId;

        // 配置・日報・工種などの削除と見積の紐付け解除を1トランザクションで行う（途中で失敗しても何も消えない）
        const { error } = await supabase.rpc('delete_project', { p_project_id: id });
        if (error) {
            console.error(error);
            showToast("削除に失敗しました: " + error.message, 'error');
            return;
        }

        setProjects(prev => prev.filter(p => p.id !== id));
        if (activeProjectId === id) {
            setActiveProjectId(projects.find(p => p.id !== id).id);
            setActiveTab && setActiveTab('dashboard');
        }
        setIsDeleteModalOpen(false);
        setPendingDeleteId(null);
    };

    const handleSiteNameBlur = async (id, newName) => {
        const trimmedName = newName ? newName.trim() : '';
        if (trimmedName === '') return;

        if (projects.some(p => p.id !== id && p.siteName === trimmedName)) {
            showToast('既に同名の現場が存在します。別の名前で登録して下さい。', 'error');
            return;
        }

        const { error } = await supabase.from('Projects').update({ name: trimmedName }).eq('id', id);
        if (error) {
            if (error.code === '23505') {
                showToast('既に同名の現場が存在します。別の名前で登録して下さい。', 'error');
            } else {
                showToast('現場名の更新に失敗しました: ' + error.message, 'error');
            }
        }
    };

    const handleForemanChange = async (id, workerIdStr) => {
        const workerId = workerIdStr ? Number(workerIdStr) : null;
        const before = projectsRef.current.find(p => p.id === id);
        patchProject(id, { foreman_worker_id: workerId });
        await confirmSaved(
            supabase.from('Projects').update({ foreman_worker_id: workerId }).eq('id', id),
            '職長の変更',
            () => patchProject(id, { foreman_worker_id: before?.foreman_worker_id ?? null }),
        );
    };

    const handleProjectStatusChange = async (id, newStatus) => {
        const before = projectsRef.current.find(p => p.id === id);
        patchProject(id, { status: newStatus });
        await confirmSaved(
            supabase.from('Projects').update({ status: newStatus }).eq('id', id),
            'ステータスの変更',
            () => patchProject(id, { status: before?.status }),
        );
    };

    const updateProjectVisibilityAndStatus = async (id, newStatus, showOnHome) => {
        const before = projectsRef.current.find(p => p.id === id);
        patchProject(id, { status: newStatus, show_on_home: showOnHome });
        await confirmSaved(
            supabase.from('Projects').update({ status: newStatus, show_on_home: showOnHome }).eq('id', id),
            'ステータスの変更',
            () => patchProject(id, { status: before?.status, show_on_home: before?.show_on_home }),
        );
    };

    const reorderAndMoveProjects = async (draggedId, targetStatus, targetProjectId, position = 'before') => {
        if (!draggedId) return;

        // 1. ローカルの projects を order 順にソートしてコピー
        const sortedProjects = [...projects].sort((a, b) => (a.order || 0) - (b.order || 0));
        const draggedIndex = sortedProjects.findIndex(p => p.id === draggedId);
        if (draggedIndex === -1) return;

        // ドラッグしたプロジェクトを取り出し、ステータスとホーム表示を変更
        const [draggedProject] = sortedProjects.splice(draggedIndex, 1);
        draggedProject.status = targetStatus;
        draggedProject.show_on_home = true;

        // 挿入インデックスの決定
        let insertIndex = sortedProjects.length;

        if (targetProjectId) {
            // カードの上にドロップされた場合: position が 'after' ならそのカードの直後、'before' なら直前に挿入
            const index = sortedProjects.findIndex(p => p.id === targetProjectId);
            if (index !== -1) {
                insertIndex = position === 'after' ? index + 1 : index;
            }
        } else {
            // カラムの余白にドロップされた場合（末尾への移動）:
            // ドロップ先カラムの「最後のプロジェクト」を探し、その直後に挿入する
            const targetStatusProjects = sortedProjects.filter(p => p.status === targetStatus);
            if (targetStatusProjects.length > 0) {
                const lastTargetProject = targetStatusProjects[targetStatusProjects.length - 1];
                const lastIndex = sortedProjects.findIndex(p => p.id === lastTargetProject.id);
                if (lastIndex !== -1) {
                    insertIndex = lastIndex + 1;
                }
            } else {
                // カラムが空の場合は配列の末尾
                insertIndex = sortedProjects.length;
            }
        }

        // 指定位置に挿入
        sortedProjects.splice(insertIndex, 0, draggedProject);

        // 全体の order を 1 から再構築
        sortedProjects.forEach((p, idx) => {
            p.order = idx + 1;
        });

        // 楽観的UI更新
        setProjects(sortedProjects);

        try {
            // DBの一意性制約エラー（Projects_order_key）を防ぐため、
            // まずは全プロジェクトの order カラムを一時的に絶対に重複しないユニークな値（10000 + id）に退避する。
            const tempPromises = sortedProjects.map(p =>
                supabase.from('Projects')
                    .update({ order: 10000 + Number(p.id) })
                    .eq('id', p.id)
            );
            const tempResults = await Promise.all(tempPromises);
            const tempError = tempResults.find(r => r.error);
            if (tempError) throw tempError.error;

            // 本番の order および status でコミットする。
            // 全てが一度 10000 以上の値に退避されているため、順次/並列で書き戻しても衝突が発生しない。
            const finalPromises = sortedProjects.map(p =>
                supabase.from('Projects')
                    .update({ 
                        status: p.status, 
                        order: p.order, 
                        show_on_home: p.show_on_home 
                    })
                    .eq('id', p.id)
            );
            const results = await Promise.all(finalPromises);
            const errorResult = results.find(r => r.error);
            if (errorResult) throw errorResult.error;

        } catch (error) {
            console.error('プロジェクトの並び替え・移動の保存に失敗しました:', error);
            showToast('順序の保存に失敗しました: ' + error.message, 'error');
            // エラー時はDBから再取得してリカバリ
            if (activeProjectId) {
                const savedId = activeProjectId;
                const { data: pData } = await supabase.from('Projects').select('*').order('created_at', { ascending: true });
                if (pData) {
                    setProjects(prev => prev.map(p => {
                        const dbP = pData.find(dp => dp.id === p.id);
                        if (dbP) {
                            return { ...p, status: dbP.status, order: dbP.order, show_on_home: dbP.show_on_home ?? true };
                        }
                        return p;
                    }));
                }
            }
        }
    };

    const handleProjectDateChange = async (id, field, value) => {
        // バリデーション
        if (value) {
            const currentStart = field === 'startDate' ? value : activeProject.startDate;
            const currentEnd = field === 'endDate' ? value : activeProject.endDate;

            if (currentStart && currentEnd && currentStart > currentEnd) {
                showToast('工期設定エラー：終了日は開始日より後の日付を指定してください。', 'error');
                return;
            }
        }

        const before = projectsRef.current.find(p => p.id === id);
        patchProject(id, { [field]: value });
        await confirmSaved(
            supabase.from('Projects').update({ [field]: value }).eq('id', id),
            '工期の変更',
            () => patchProject(id, { [field]: before?.[field] ?? null }),
        );
    };

    const updateMasterItemLocal = (id, field, value) => {
        updateLayer(p => ({
            masterData: p.masterData.map(m => m.id === id ? { ...m, [field]: value } : m)
        }));
    };

    const saveMasterItemDB = async (dbItemId, updateData) => {
        if (String(dbItemId).startsWith('temp-')) return;
        // 入力中は画面だけを書き換えている（updateMasterItemLocal）ため、失敗時は知らせて入力し直してもらう
        await confirmSaved(supabase.from('ProjectTasks').update(updateData).eq('id', dbItemId), '作業項目の保存');
    };

    const reorderMasterItems = async (newMasterData) => {
        if (!activeProjectId) return;

        const previousMasterData = activeProject.masterData;
        // 1. ローカル状態を先行更新（楽観的UI更新）
        updateLayer(p => ({
            masterData: newMasterData
        }));

        try {
            // 2. 一意性制約の衝突を防ぐため、一時的に order を負の数に退避
            const tempPromises = newMasterData.map((item, idx) =>
                supabase.from('ProjectTasks')
                    .update({ order: -(idx + 1) })
                    .eq('id', item.id)
            );
            const tempResults = await Promise.all(tempPromises);
            const tempError = tempResults.find(r => r.error);
            if (tempError) throw tempError.error;

            // 3. 正しい順序を設定
            const updatePromises = newMasterData.map((item, idx) =>
                supabase.from('ProjectTasks')
                    .update({ order: idx + 1 })
                    .eq('id', item.id)
            );
            const results = await Promise.all(updatePromises);
            
            const errorResult = results.find(r => r.error);
            if (errorResult) {
                throw errorResult.error;
            }
        } catch (error) {
            console.error('仕様項目の並び替えに失敗しました:', error);
            // 画面の並びを元に戻す
            updateLayer(() => ({ masterData: previousMasterData }));
            showToast('並び替えの保存に失敗しました: ' + error.message, 'error');
        }
    };

    const addMasterItem = async () => {
        if (!activeProjectId) return;

        const newItemInfo = {
            projectId: activeProjectId,
            name: '新規作業項目',
            target_hours: 0,
            estimated_amount: 0,
            order: activeProject.masterData.length + 1,
            progress_percentage: 0
        };

        const { data, error } = await supabase.from('ProjectTasks').insert([newItemInfo]).select();
        if (error) {
            console.error(error);
            showToast("項目の追加に失敗しました。", 'error');
            return;
        }

        const dbRec = data[0];
        updateLayer(p => ({
            masterData: [...p.masterData, { id: dbRec.id, task: dbRec.name, target: dbRec.target_hours, estimatedAmount: dbRec.estimated_amount || 0 }],
            progressData: { ...p.progressData, [dbRec.id]: 0 }
        }));
    };

    const removeMasterItem = async (taskId) => {
        const ok = await confirm({
            title: '作業項目の削除',
            message: 'この作業項目を削除すると、紐づく実績データもすべて削除されます。\n本当によろしいですか？',
            confirmText: '削除する',
        });
        if (!ok) return;

        const { error } = await supabase.from('ProjectTasks').delete().eq('id', taskId);
        if (error) {
            console.error(error);
            showToast("項目の削除に失敗しました。", 'error');
            return;
        }

        updateLayer(p => ({
            masterData: p.masterData.filter(m => m.id !== taskId),
            records: p.records.filter(r => r.taskId !== taskId)
        }));
    };

    const saveProgressDB = async (dbItemId, value) => {
        if (String(dbItemId).startsWith('temp-')) return;
        await confirmSaved(supabase.from('ProjectTasks').update({ progress_percentage: value }).eq('id', dbItemId), '進捗の保存');
    };

    const addRecord = async (params = {}) => {
        const initialValues = params.initialValues || {};
        const defaultTaskId = activeProject.masterData[0]?.id;
        
        if (!defaultTaskId && !initialValues.taskId) {
            showToast("先に工事設定で作業項目を登録してください", 'error');
            return;
        }

        // toISOString は UTC のため、日本時間の 0〜9 時に前日の日付になる。ローカル日付を使う
        const date = initialValues.date || toDateStr(new Date());
        const workerName = initialValues.worker || (workers && workers.length > 0 ? workers[0].name : '');
        const taskId = initialValues.taskId || defaultTaskId;
        const hours = initialValues.hours || 0;
        const note = initialValues.note || '';

        const { data, error } = await supabase.from('TaskRecords').insert([{
            project_task_id: taskId,
            project_id: activeProjectId,
            date: date,
            worker_name: workerName,
            hours: hours,
            note: note
        }]).select();

        if (error) {
            console.error(error);
            showToast("日報の追加に失敗しました。", 'error');
            return;
        }

        const dbRec = data[0];
        updateLayer(p => ({
            records: [{ id: dbRec.id, date: dbRec.date, taskId: dbRec.project_task_id, worker: dbRec.worker_name, hours: dbRec.hours, note: dbRec.note }, ...p.records]
        }));
    };

    const removeRecord = async (recordId) => {
        const ok = await confirmSaved(supabase.from('TaskRecords').delete().eq('id', recordId), '日報の削除');
        if (!ok) return;
        updateLayer(p => ({ records: p.records.filter(r => r.id !== recordId) }));
    };

    const updateRecordField = async (recordId, field, value) => {
        const previous = activeProject.records.find(r => r.id === recordId)?.[field];
        updateLayer(p => ({
            records: p.records.map(r => r.id === recordId ? { ...r, [field]: value } : r)
        }));

        const dbFieldMap = { date: 'date', taskId: 'project_task_id', worker: 'worker_name', hours: 'hours', note: 'note' };
        if (dbFieldMap[field]) {
            await confirmSaved(
                supabase.from('TaskRecords').update({ [dbFieldMap[field]]: value }).eq('id', recordId),
                '日報の保存',
                () => updateLayer(p => ({
                    records: p.records.map(r => r.id === recordId ? { ...r, [field]: previous } : r)
                })),
            );
        }
    };

    const addSubcontractorRecord = async () => {
        const newDbRecord = {
            project_id: activeProjectId,
            date: toDateStr(new Date()),
            company_name: '',
            worker_count: 1,
            unit_price: 0,
            worker_name: ''
        };

        const { data, error } = await supabase.from('SubcontractorRecords').insert([newDbRecord]).select();
        if (error) {
            console.error(error);
            showToast('協力業者の追加に失敗しました: ' + error.message, 'error');
            return;
        }

        updateLayer(p => ({ subcontractors: [data[0], ...(p.subcontractors || [])] }));
    };

    const removeSubcontractorRecord = async (recordId) => {
        const ok = await confirmSaved(supabase.from('SubcontractorRecords').delete().eq('id', recordId), '協力業者の削除');
        if (!ok) return;
        updateLayer(p => ({ subcontractors: (p.subcontractors || []).filter(r => r.id !== recordId) }));
    };

    const updateSubcontractorRecordField = async (recordId, field, value) => {
        const previous = (activeProject.subcontractors || []).find(r => r.id === recordId)?.[field];
        updateLayer(p => ({
            subcontractors: (p.subcontractors || []).map(r => r.id === recordId ? { ...r, [field]: value } : r)
        }));
        await confirmSaved(
            supabase.from('SubcontractorRecords').update({ [field]: value }).eq('id', recordId),
            '協力業者の保存',
            () => updateLayer(p => ({
                subcontractors: (p.subcontractors || []).map(r => r.id === recordId ? { ...r, [field]: previous } : r)
            })),
        );
    };

    return {
        activeProject,
        updateLayer,
        addNewProject,
        importProjectFromExcel,
        removeProject,
        handleSiteNameBlur,
        handleForemanChange,
        handleProjectStatusChange,
        updateProjectVisibilityAndStatus,
        reorderAndMoveProjects,
        handleProjectDateChange,
        isDeleteModalOpen,
        setIsDeleteModalOpen,
        confirmRemoveProject,
        updateMasterItemLocal,
        saveMasterItemDB,
        reorderMasterItems,
        addMasterItem,
        removeMasterItem,
        saveProgressDB,
        addRecord,
        removeRecord,
        updateRecordField,
        addSubcontractorRecord,
        removeSubcontractorRecord,
        updateSubcontractorRecordField
    };
}
