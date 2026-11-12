// HOURLY_WAGE is now dynamically passed as 'hourlyWage' in calculateProjectsSummary
import { PROJECT_STATUS, CONTRACT_TYPE } from './constants';

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
 * 日報の協力業者記録を「請負期間内」と「常用」に振り分ける。
 * DB の `_subcontractor_in_ukeoi`（20261112000000）と同じ規則（パリティテストで固定）:
 *   - 同じ現場・同じ会社の請負契約の期間（開始日〜終了日の両日を含む。終了日 NULL は継続中）に日付が入る記録は請負
 *   - それ以外（会社に未紐づけの旧記録を含む）は常用
 * 日付は 'YYYY-MM-DD' の文字列として比べる。
 * @param {Array<{project_id?: number, subcontractor_id?: number|null, date: string}>} records
 * @param {Array<{type: string, project_id?: number, subcontractor_id: number, start_date?: string|null, end_date?: string|null}>} contracts
 * @returns {{joyo: Array, ukeoi: Array}}
 */
export function classifySubcontractorRecords(records, contracts) {
    const ukeoiContracts = (contracts || []).filter(c => c.type === CONTRACT_TYPE.UKEOI && c.start_date);
    const joyo = [];
    const ukeoi = [];
    (records || []).forEach(r => {
        const inUkeoi = r.subcontractor_id != null && ukeoiContracts.some(c =>
            c.subcontractor_id === r.subcontractor_id
            && (c.project_id == null || r.project_id == null || c.project_id === r.project_id)
            && r.date >= c.start_date
            && (c.end_date == null || r.date <= c.end_date)
        );
        (inUkeoi ? ukeoi : joyo).push(r);
    });
    return { joyo, ukeoi };
}

/**
 * 契約を変更（削除・期間の変更）したとき、請負 ↔ 常用の扱いが変わる記録の件数。確認ダイアログの表示用。
 * @param {Array} records 協力業者の記録（その現場の全件）
 * @param {Array} contractsBefore 変更前の契約
 * @param {Array} contractsAfter 変更後の契約
 * @returns {number}
 */
export function countReclassifiedRecords(records, contractsBefore, contractsAfter) {
    const before = new Set(classifySubcontractorRecords(records, contractsBefore).ukeoi.map(r => r.id));
    const after = new Set(classifySubcontractorRecords(records, contractsAfter).ukeoi.map(r => r.id));
    return (records || []).filter(r => before.has(r.id) !== after.has(r.id)).length;
}

/**
 * 協力業者原価の合計。
 *   常用 = 請負期間外の記録の 人数 × 記録の単価
 *   請負 = 請負契約の契約金額（契約登録時に全額）
 * contracts を渡さなければ、全記録を常用として計上する（従来どおり）。
 * @param {Array<{worker_count: number|string, unit_price?: number|string}>} subcontractors
 * @param {Array} [contracts] SubcontractContracts の行
 * @returns {number}
 */
export function calcSubcontractorCost(subcontractors, contracts = []) {
    const { joyo } = classifySubcontractorRecords(subcontractors, contracts);
    const joyoCost = joyo.reduce(
        (sum, s) => sum + Number(s.worker_count) * Number(s.unit_price || 0),
        0
    );
    const ukeoiCost = (contracts || [])
        .filter(c => c.type === CONTRACT_TYPE.UKEOI)
        .reduce((sum, c) => sum + Number(c.contract_amount || 0), 0);
    return joyoCost + ukeoiCost;
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
 * @param {Array} [contracts] 協力業者の契約（常用/請負）。省略時は全記録を常用として計上
 * @returns {{totalTarget: number, totalActual: number, overallProgress: number,
 *            subcontractorCost: number, predictedProfitLoss: number}}
 *          overallProgress は丸めなし。predictedProfitLoss は協力業者原価を差し引いた後の値
 */
export function summarizeTaskCosts(items, hourlyWage, subcontractors = [], contracts = []) {
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

    const subcontractorCost = calcSubcontractorCost(subcontractors, contracts);

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
            summarizeTaskCosts(items, hourlyWage, proj.subcontractors, proj.subcontractContracts);

        let overallProgress = Math.round(overallProgressValue);
        if (proj.status === PROJECT_STATUS.COMPLETED && masterData.length === 0) {
            overallProgress = 100;
        }

        // 完了などで明細（工種・日報）をまだ読み込んでいない現場は、損益を計算できない。
        // 0 円と出すと「損益ゼロ」と誤解されるため null にし、表示側で「未集計」と出す。
        const notLoaded = proj._isLoaded === false;
        return {
            ...proj,
            totalActual,
            totalTarget,
            overallProgress,
            predictedProfitLoss: notLoaded ? null : predictedProfitLoss,
        };
    });
};

/**
 * predictedProfitLoss（予測損益）の表示用フォーマット。
 * 符号付きの¥表示文字列を返す（例: "+¥12,345" / "-¥6,789"）。未集計（null）は "未集計"。
 * @param {number} value
 * @returns {string}
 */
export const formatProfitLoss = (value) => {
    if (value === null || value === undefined) return '未集計';
    const v = Number(value) || 0;
    return `${v >= 0 ? '+' : '-'}¥${Math.abs(Math.round(v)).toLocaleString()}`;
};
