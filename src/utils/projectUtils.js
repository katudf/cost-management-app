import { HOURLY_WAGE } from './constants';

export const calculateProjectsSummary = (projects) => {
    return projects.map(proj => {
        const masterData = proj.masterData || [];
        const records = proj.records || [];
        const progressData = proj.progressData || {};

        let totalActual = 0;
        let totalTarget = 0;
        let totalPredictedLoss = 0;

        masterData.forEach(m => {
            const actual = records.filter(r => r.taskId === m.id).reduce((sum, r) => sum + Number(r.hours), 0);
            const progress = progressData[m.id] || 0;
            const predictedFinal = progress > 0 ? (actual / (progress / 100)) : 0;
            const predictedProfitLoss = progress > 0 ? (m.target - predictedFinal) * HOURLY_WAGE : 0;

            totalActual += actual;
            totalTarget += m.target;
            totalPredictedLoss += predictedProfitLoss;
        });

        const overallProgressValue = totalTarget > 0 ? (masterData.reduce((sum, m) => sum + ((progressData[m.id] || 0) * m.target), 0) / totalTarget) : 0;
        const subcontractorCost = (proj.subcontractors || []).reduce((sum, s) => sum + (Number(s.worker_count) * Number(s.unit_price || 25000)), 0);

        return {
            ...proj,
            totalActual,
            totalTarget,
            overallProgress: Math.round(overallProgressValue),
            predictedProfitLoss: totalPredictedLoss - subcontractorCost
        };
    });
};
