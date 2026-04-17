import { useState, useMemo } from 'react';
import { calculateProjectsSummary } from '../utils/projectUtils';

export function useDashboardStats({ projects, activeProject, hourlyWage }) {
    const [filterStatuses, setFilterStatuses] = useState(['見積', '予定', '施工中', '完了']);
    const [sortOption, setSortOption] = useState('created_desc');

    const toggleFilterStatus = (status) => {
        setFilterStatuses(prev =>
            prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
        );
    };

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
        let list = allProjectsSummary.filter(p => filterStatuses.includes(p.status || '予定'));
        list.sort((a, b) => {
            if (sortOption === 'created_desc') return b.id - a.id;
            if (sortOption === 'created_asc') return a.id - b.id;
            if (sortOption === 'progress_desc') return b.overallProgress - a.overallProgress;
            if (sortOption === 'progress_asc') return a.overallProgress - b.overallProgress;
            if (sortOption === 'profit_desc') return b.predictedProfitLoss - a.predictedProfitLoss;
            if (sortOption === 'profit_asc') return a.predictedProfitLoss - b.predictedProfitLoss;
            return 0; // default order
        });
        return list;
    }, [allProjectsSummary, filterStatuses, sortOption]);

    return {
        filterStatuses,
        toggleFilterStatus,
        sortOption,
        setSortOption,
        allProjectsSummary,
        workerSummaryData,
        summaryData,
        displayProjects
    };
}
