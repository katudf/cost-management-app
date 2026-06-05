import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { PROJECT_STATUS } from '../utils/constants';

export function useSupabaseData(showToast) {
    const [projects, setProjects] = useState([]);
    const [workers, setWorkers] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [hourlyWage, setHourlyWage] = useState(3500);
    const [isGeminiEnabled, setIsGeminiEnabled] = useState(true);
    const [isLoading, setIsLoading] = useState(true);

    const fetchAllData = useCallback(async (forceActiveId = null, setActiveProjectId) => {
        if (!supabase) return;
        setIsLoading(true);
        try {
            // LocalStorage からのアクティブID復元や forceActiveId の確認
            const savedId = localStorage.getItem('cost-app-activeProjectId');
            const restoredId = savedId ? Number(JSON.parse(savedId)) : null;
            const targetActiveId = forceActiveId ? Number(forceActiveId) : restoredId;

            // Workers取得
            const { data: wData, error: wError } = await supabase.from('Workers').select('*').order('display_order', { ascending: true, nullsFirst: false });
            if (wError) throw wError;

            // WorkerCertifications取得
            const { data: cData, error: cError } = await supabase.from('WorkerCertifications').select('*');
            if (cError) throw cError;

            if (wData) {
                const validWorkers = wData.filter(w => w.name && w.name.trim() !== '');
                const workersWithCerts = validWorkers.map(w => ({
                    ...w,
                    certifications: cData ? cData.filter(c => Number(c.workerId) === Number(w.id)) : []
                }));
                setWorkers(workersWithCerts);
            }

            // Customers取得
            const { data: custData, error: custError } = await supabase.from('Customers').select('*').order('name', { ascending: true });
            if (custError) throw custError;
            if (custData) setCustomers(custData);

            // Projects取得 (一覧用のため全件取得)
            const { data: pData, error: pError } = await supabase.from('Projects').select('*').order('order', { ascending: true });
            if (pError) throw pError;

            // アクティブなプロジェクトIDリスト（完了以外 ＋ 現在表示予定のアクティブID）
            const activeProjectIds = pData ? pData.filter(p => p.status !== PROJECT_STATUS.COMPLETED).map(p => p.id) : [];
            if (targetActiveId && !activeProjectIds.includes(targetActiveId)) {
                activeProjectIds.push(targetActiveId);
            }

            // 詳細データを activeProjectIds に絞って取得
            let tData = [];
            let rData = [];
            let sData = [];

            if (activeProjectIds.length > 0) {
                const { data: tasks, error: tError } = await supabase
                    .from('ProjectTasks')
                    .select('*')
                    .in('projectId', activeProjectIds)
                    .order('order', { ascending: true });
                if (tError) throw tError;
                tData = tasks || [];

                const { data: records, error: rError } = await supabase
                    .from('TaskRecords')
                    .select('*')
                    .in('project_id', activeProjectIds)
                    .order('date', { ascending: false });
                if (rError) throw rError;
                rData = records || [];

                const { data: subs, error: sError } = await supabase
                    .from('SubcontractorRecords')
                    .select('*')
                    .in('project_id', activeProjectIds);
                if (sError) throw sError;
                sData = subs || [];
            }

            const { data: settingsData, error: settingsError } = await supabase.from('system_settings').select('hourly_wage').eq('id', 1).single();
            if (!settingsError && settingsData) {
                setHourlyWage(settingsData.hourly_wage);
            }

            // ローカルステート用の構造にマッピング
            const loadedProjects = pData.map(p => {
                const isLoaded = activeProjectIds.includes(p.id);

                if (!isLoaded) {
                    return {
                        id: p.id,
                        order: p.order,
                        siteName: (p.name && p.name.startsWith('__NEW_PROJECT__')) ? '' : (p.name || '無題'),
                        status: p.status || PROJECT_STATUS.SCHEDULED,
                        foreman_worker_id: p.foreman_worker_id || null,
                        customerId: p.customerId || null,
                        is_prime_contractor: p.is_prime_contractor || false,
                        startDate: p.startDate || null,
                        endDate: p.endDate || null,
                        bar_color: p.bar_color || null,
                        show_on_home: p.show_on_home ?? true,
                        masterData: [],
                        records: [],
                        progressData: {},
                        subcontractors: [],
                        _isLoaded: false
                    };
                }

                const myTasks = tData.filter(t => t.projectId === p.id);
                const myRecords = rData.filter(r => r.project_id === p.id);

                const masterData = myTasks.map(t => ({
                    id: t.id,
                    task: t.name || '',
                    target: t.target_hours || 0,
                    estimatedAmount: t.estimated_amount || 0
                }));

                const progressData = {};
                myTasks.forEach(t => {
                    progressData[t.id] = t.progress_percentage || 0;
                });

                const records = myRecords.map(r => ({
                    id: r.id,
                    date: r.date,
                    taskId: r.project_task_id,
                    worker: r.worker_name || '',
                    hours: r.hours || 0,
                    overtime_hours: r.overtime_hours || 0,
                    note: r.note || ''
                }));

                const mySubcontractors = (sData || []).filter(s => s.project_id === p.id);

                return {
                    id: p.id,
                    order: p.order,
                    siteName: (p.name && p.name.startsWith('__NEW_PROJECT__')) ? '' : (p.name || '無題'),
                    status: p.status || PROJECT_STATUS.SCHEDULED,
                    foreman_worker_id: p.foreman_worker_id || null,
                    customerId: p.customerId || null,
                    is_prime_contractor: p.is_prime_contractor || false,
                    startDate: p.startDate || null,
                    endDate: p.endDate || null,
                    bar_color: p.bar_color || null,
                    show_on_home: p.show_on_home ?? true,
                    masterData,
                    records,
                    progressData,
                    subcontractors: mySubcontractors,
                    _isLoaded: true
                };
            });

            setProjects(loadedProjects);

            // ActiveProjectの復元
            if (loadedProjects.length > 0 && setActiveProjectId) {
                if (forceActiveId && loadedProjects.some(lp => lp.id === Number(forceActiveId))) {
                    setActiveProjectId(Number(forceActiveId));
                } else {
                    if (restoredId && loadedProjects.some(lp => lp.id === restoredId)) {
                        setActiveProjectId(restoredId);
                    } else {
                        setActiveProjectId(loadedProjects[0].id);
                    }
                }
            } else if (setActiveProjectId) {
                setActiveProjectId(null);
            }
        } catch (error) {
            console.error('データ取得エラー:', error);
            if (showToast) showToast('データ取得エラー: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    // 特定プロジェクトの詳細データを非同期で遅延取得する関数
    const fetchProjectDetails = useCallback(async (projectId) => {
        if (!supabase || !projectId) return;

        setIsLoading(true);
        try {
            // 対象プロジェクトの ProjectTasks
            const { data: tData, error: tError } = await supabase
                .from('ProjectTasks')
                .select('*')
                .eq('projectId', projectId)
                .order('order', { ascending: true });
            if (tError) throw tError;

            // 対象プロジェクトの TaskRecords
            const { data: rData, error: rError } = await supabase
                .from('TaskRecords')
                .select('*')
                .eq('project_id', projectId)
                .order('date', { ascending: false });
            if (rError) throw rError;

            // 対象プロジェクトの SubcontractorRecords
            const { data: sData, error: sError } = await supabase
                .from('SubcontractorRecords')
                .select('*')
                .eq('project_id', projectId);
            if (sError) throw sError;

            // データのマッピング
            const masterData = (tData || []).map(t => ({
                id: t.id,
                task: t.name || '',
                target: t.target_hours || 0,
                estimatedAmount: t.estimated_amount || 0
            }));

            const progressData = {};
            (tData || []).forEach(t => {
                progressData[t.id] = t.progress_percentage || 0;
            });

            const records = (rData || []).map(r => ({
                id: r.id,
                date: r.date,
                taskId: r.project_task_id,
                worker: r.worker_name || '',
                hours: r.hours || 0,
                overtime_hours: r.overtime_hours || 0,
                note: r.note || ''
            }));

            const subcontractors = sData || [];

            // projects ステートの更新
            setProjects(prev => prev.map(p => {
                if (p.id === projectId) {
                    return {
                        ...p,
                        masterData,
                        records,
                        progressData,
                        subcontractors,
                        _isLoaded: true
                    };
                }
                return p;
            }));

        } catch (e) {
            console.error('工事詳細の遅延取得エラー:', e);
            if (showToast) showToast('工事詳細のロードに失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    return {
        projects,
        setProjects,
        workers,
        setWorkers,
        customers,
        setCustomers,
        hourlyWage,
        setHourlyWage,
        isGeminiEnabled,
        setIsGeminiEnabled,
        isLoading,
        setIsLoading,
        fetchAllData,
        fetchProjectDetails
    };
}
