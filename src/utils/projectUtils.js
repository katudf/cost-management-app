// HOURLY_WAGE is now dynamically passed as 'hourlyWage' in calculateProjectsSummary
import { PROJECT_STATUS } from './constants';

/**
 * 原価集計の共通コア。
 *
 * 同じ4つの計算式が AdminApp（projects/masterData 形）と WorkerApp（tasks 形）で
 * 別々に書かれていたため、データ形に依存しない形でここに1本化する。
 * 呼び出し側は自分のデータを {target, actual, progress} の配列に正規化してから渡す。
 *
 * 用語:
 *   - 予測着地   = 実績 / (進捗率 / 100)   … このペースで進んだ場合の最終工数
 *   - 予測損益   = (目標 - 予測着地) * 時間単価
 *   - 加重平均進捗 = Σ(進捗 * 目標) / Σ目標
 */

/**
 * 1工種の予測着地工数。進捗0のときは予測不能なので0を返す。
 * @param {number} actual 実績工数
 * @param {number} progress 進捗率（0-100）
 * @returns {number}
 */
export function calcPredictedFinal(actual, progress) {
    return progress > 0 ? actual / (progress / 100) : 0;
}

/**
 * 1工種の予測損益（金額）。進捗0のときは0。
 * @param {number} target 目標工数
 * @param {number} actual 実績工数
 * @param {number} progress 進捗率（0-100）
 * @param {number} hourlyWage 時間単価
 * @returns {number}
 */
export function calcPredictedProfitLoss(target, actual, progress, hourlyWage) {
    if (!(progress > 0)) return 0;
    return (target - calcPredictedFinal(actual, progress)) * hourlyWage;
}

/**
 * 協力業者原価の合計。
 * @param {Array<{worker_count: number|string, unit_price?: number|string}>} subcontractors
 * @returns {number}
 */
export function calcSubcontractorCost(subcontractors) {
    return (subcontractors || []).reduce(
        (sum, s) => sum + Number(s.worker_count) * Number(s.unit_price || 0),
        0
    );
}

/**
 * 目標工数で重み付けした全体進捗率（丸めなし）。目標合計が0なら0。
 * @param {Array<{target: number, progress: number}>} items
 * @returns {number}
 */
export function calcWeightedProgress(items) {
    const totalTarget = items.reduce((sum, i) => sum + Number(i.target || 0), 0);
    if (!(totalTarget > 0)) return 0;
    return items.reduce((sum, i) => sum + Number(i.progress || 0) * Number(i.target || 0), 0) / totalTarget;
}

/**
 * 正規化済みの工種配列から原価サマリーを求める、形に依存しない集計関数。
 *
 * @param {Array<{target: number, actual: number, progress: number}>} items
 *        呼び出し側でデータ形を吸収して渡す工種の配列
 * @param {number} hourlyWage 時間単価
 * @param {Array<{worker_count: number|string, unit_price?: number|string}>} [subcontractors]
 * @returns {{totalTarget: number, totalActual: number, overallProgress: number,
 *            subcontractorCost: number, predictedProfitLoss: number}}
 *          overallProgress は丸めなし。predictedProfitLoss は協力業者原価を差し引いた後の値
 */
export function summarizeTaskCosts(items, hourlyWage, subcontractors = []) {
    let totalTarget = 0;
    let totalActual = 0;
    let totalPredictedProfitLoss = 0;

    items.forEach(i => {
        const target = Number(i.target || 0);
        const actual = Number(i.actual || 0);
        const progress = Number(i.progress || 0);
        totalTarget += target;
        totalActual += actual;
        totalPredictedProfitLoss += calcPredictedProfitLoss(target, actual, progress, hourlyWage);
    });

    const subcontractorCost = calcSubcontractorCost(subcontractors);

    return {
        totalTarget,
        totalActual,
        overallProgress: calcWeightedProgress(items),
        subcontractorCost,
        predictedProfitLoss: totalPredictedProfitLoss - subcontractorCost,
    };
}

export const calculateProjectsSummary = (projects, hourlyWage) => {
    return projects.map(proj => {
        const masterData = proj.masterData || [];
        const records = proj.records || [];
        const progressData = proj.progressData || {};

        // masterData/records/progressData 形を共通コアの {target, actual, progress} 形に正規化する
        const items = masterData.map(m => ({
            target: Number(m.target || 0),
            actual: records.filter(r => r.taskId === m.id).reduce((sum, r) => sum + Number(r.hours), 0),
            progress: progressData[m.id] || 0,
        }));

        const { totalActual, totalTarget, overallProgress: overallProgressValue, predictedProfitLoss } =
            summarizeTaskCosts(items, hourlyWage, proj.subcontractors);

        let overallProgress = Math.round(overallProgressValue);
        if (proj.status === PROJECT_STATUS.COMPLETED && masterData.length === 0) {
            overallProgress = 100;
        }

        return {
            ...proj,
            totalActual,
            totalTarget,
            overallProgress,
            predictedProfitLoss
        };
    });
};

/**
 * predictedProfitLoss（予測損益）の表示用フォーマット。
 * 符号付きの¥表示文字列を返す（例: "+¥12,345" / "-¥6,789"）。
 * @param {number} value
 * @returns {string}
 */
export const formatProfitLoss = (value) => {
    const v = Number(value) || 0;
    return `${v >= 0 ? '+' : '-'}¥${Math.abs(Math.round(v)).toLocaleString()}`;
};
