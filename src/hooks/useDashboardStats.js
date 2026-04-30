import { useState, useMemo } from 'react';
import { calculateProjectsSummary } from '../utils/projectUtils';

export function useDashboardStats({ projects, activeProject, hourlyWage }) {
    const [searchQuery, setSearchQuery] = useState('');

    const allProjectsSummary = useMemo(() => {
        return calculateProjectsSummary(projects, hourlyWage);
    }, [projects, hourlyWage]);

    const workerSummaryData = useMemo(() => {
        const allRecords = projects.flatMap(p =>
            p.records.map(r => ({ ...r, siteName: p.siteName }))
        );

        const summary = {};
        allRecords.forEach(r => {
            if (!r.worker) return;
            if (!summary[r.worker]) {
                summary[r.worker] = { totalHours: 0, projects: new Set() };
            }
            summary[r.worker].totalHours += Number(r.hours) || 0;
            if (r.siteName) {
                summary[r.worker].projects.add(r.siteName);
            }
        });

        return Object.entries(summary).map(([name, data]) => ({
            name,
            totalHours: data.totalHours,
            projects: Array.from(data.projects).sort()
        })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [projects]);

    const summaryData = useMemo(() => {
        if (!activeProject || !activeProject.masterData) return { items: [], totalActual: 0, totalTarget: 0, totalPredictedProfitLoss: 0, subcontractorCost: 0 };
        const items = activeProject.masterData.map(m => {
            const actual = activeProject.records.filter(r => r.taskId === m.id).reduce((sum, r) => sum + Number(r.hours), 0);
            const progress = activeProject.progressData[m.id] || 0;
            const consumptionRate = m.target > 0 ? (actual / m.target) * 100 : 0;
            const variance = progress - consumptionRate;

            const predictedFinal = progress > 0 ? (actual / (progress / 100)) : 0;
            const predictedProfitLoss = progress > 0 ? (m.target - predictedFinal) * hourlyWage : 0;

            return { ...m, actual, progress, variance, predictedProfitLoss, status: variance < -5 ? 'danger' : variance < 0 ? 'warning' : 'ok' };
        });

        const totalActual = items.reduce((sum, i) => sum + i.actual, 0);
        const totalTarget = items.reduce((sum, i) => sum + i.target, 0);
        const totalPredictedProfitLoss = items.reduce((sum, i) => sum + i.predictedProfitLoss, 0);
        const subcontractorCost = (activeProject.subcontractors || []).reduce((sum, s) => sum + (Number(s.worker_count) * Number(s.unit_price || 0)), 0);

        return {
            items,
            totalActual,
            totalTarget,
            totalPredictedProfitLoss: totalPredictedProfitLoss - subcontractorCost,
            subcontractorCost
        };
    }, [activeProject, hourlyWage]);

    const displayProjects = useMemo(() => {
        let list = [...allProjectsSummary]; // すべてのステータスを表示
        
        // 現場向けの共通項目（社内業務や有給など）はホームの工事一覧から除外する
        const excludedNames = ["【会社】社内業務・雑務", "【会社】有給", "有給", "【有給】"];
        list = list.filter(p => {
            const name = p.siteName || '';
            return !excludedNames.includes(name);
        });

        // 検索フィルタリング
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            list = list.filter(p => 
                (p.siteName || '').toLowerCase().includes(query)
            );
        }

        // 常に作成順（新しい順）でソート
        list.sort((a, b) => b.id - a.id);
        
        return list;
    }, [allProjectsSummary, searchQuery]);

    return {
        searchQuery,
        setSearchQuery,
        allProjectsSummary,
        workerSummaryData,
        summaryData,
        displayProjects
    };
}

