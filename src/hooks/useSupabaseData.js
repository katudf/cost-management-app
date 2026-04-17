import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useSupabaseData(showToast) {
    const [projects, setProjects] = useState([]);
    const [workers, setWorkers] = useState([]);
    const [hourlyWage, setHourlyWage] = useState(3500);
    const [geminiApiKey, setGeminiApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
    const [isLoading, setIsLoading] = useState(true);

    const fetchAllData = useCallback(async (forceActiveId = null, setActiveProjectId) => {
        if (!supabase) return;
        setIsLoading(true);
        try {
            // Workers取得
            const { data: wData } = await supabase.from('Workers').select('*').order('display_order', { ascending: true, nullsFirst: false });

            // WorkerCertifications取得
            const { data: cData } = await supabase.from('WorkerCertifications').select('*');

            if (wData) {
                const validWorkers = wData.filter(w => w.name && w.name.trim() !== '');
                const workersWithCerts = validWorkers.map(w => ({
                    ...w,
                    certifications: cData ? cData.filter(c => Number(c.workerId) === Number(w.id)) : []
                }));
                setWorkers(workersWithCerts);
            }

            // Projects, ProjectTasks, TaskRecords取得
            const { data: pData, error: pError } = await supabase.from('Projects').select('*').order('created_at', { ascending: true });
            if (pError) throw pError;

            const { data: tData, error: tError } = await supabase.from('ProjectTasks').select('*').order('order', { ascending: true });
            if (tError) throw tError;

            const { data: rData, error: rError } = await supabase.from('TaskRecords').select('*').order('date', { ascending: false });
            if (rError) throw rError;

            const { data: sData, error: sError } = await supabase.from('SubcontractorRecords').select('*');
            if (sError) throw sError;

            const { data: settingsData, error: settingsError } = await supabase.from('system_settings').select('hourly_wage').eq('id', 1).single();
            if (!settingsError && settingsData) {
                setHourlyWage(settingsData.hourly_wage);
            }

            // ローカルステート用の構造にマッピング
            const loadedProjects = pData.map(p => {
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
                    status: p.status || '予定',
                    foreman_worker_id: p.foreman_worker_id || null,
                    startDate: p.startDate || null,
                    endDate: p.endDate || null,
                    bar_color: p.bar_color || null,
                    masterData,
                    records,
                    progressData,
                    subcontractors: mySubcontractors
                };
            });

            setProjects(loadedProjects);

            // ActiveProjectの復元
            if (loadedProjects.length > 0 && setActiveProjectId) {
                if (forceActiveId && loadedProjects.some(lp => lp.id === Number(forceActiveId))) {
                    setActiveProjectId(Number(forceActiveId));
                } else {
                    const savedId = localStorage.getItem('cost-app-activeProjectId');
                    if (savedId && loadedProjects.some(lp => lp.id === Number(JSON.parse(savedId)))) {
                        setActiveProjectId(Number(JSON.parse(savedId)));
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

    return {
        projects,
        setProjects,
        workers,
        setWorkers,
        hourlyWage,
        setHourlyWage,
        geminiApiKey,
        setGeminiApiKey,
        isLoading,
        setIsLoading,
        fetchAllData
    };
}
