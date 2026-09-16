import { describe, it, expect } from 'vitest';
import {
    calcPredictedFinal,
    calcPredictedProfitLoss,
    calcSubcontractorCost,
    calcWeightedProgress,
    summarizeTaskCosts,
    calculateProjectsSummary,
} from './projectUtils';
import { PROJECT_STATUS } from './constants';

// 原価計算は AdminApp（camelCase / progressData 別持ち）と
// WorkerApp（snake_case / progress はタスク行）で別々に書かれていたものを
// summarizeTaskCosts に1本化した。両方の形で同じ答えになることを固定する。

describe('projectUtils 原価計算コア', () => {
    describe('calcPredictedFinal', () => {
        it('進捗50%で実績10hなら予測着地は20h', () => {
            expect(calcPredictedFinal(10, 50)).toBe(20);
        });

        it('進捗100%なら予測着地は実績と一致する', () => {
            expect(calcPredictedFinal(37.5, 100)).toBe(37.5);
        });

        it('進捗0のときは予測不能なので0を返す（ゼロ除算しない）', () => {
            expect(calcPredictedFinal(10, 0)).toBe(0);
        });
    });

    describe('calcPredictedProfitLoss', () => {
        it('予測着地が目標を下回れば黒字（正の値）', () => {
            // 目標30h / 実績10h / 進捗50% → 予測着地20h → (30-20)*3500 = 35000
            expect(calcPredictedProfitLoss(30, 10, 50, 3500)).toBe(35000);
        });

        it('予測着地が目標を上回れば赤字（負の値）', () => {
            // 目標10h / 実績10h / 進捗50% → 予測着地20h → (10-20)*3500 = -35000
            expect(calcPredictedProfitLoss(10, 10, 50, 3500)).toBe(-35000);
        });

        it('進捗0のときは損益を0として扱う', () => {
            expect(calcPredictedProfitLoss(30, 0, 0, 3500)).toBe(0);
        });
    });

    describe('calcSubcontractorCost', () => {
        it('人数×単価を合算する', () => {
            const subs = [
                { worker_count: 2, unit_price: 20000 },
                { worker_count: 3, unit_price: 18000 },
            ];
            expect(calcSubcontractorCost(subs)).toBe(94000);
        });

        it('unit_price が未設定なら0として扱う', () => {
            expect(calcSubcontractorCost([{ worker_count: 5 }])).toBe(0);
        });

        it('null / undefined / 空配列は0', () => {
            expect(calcSubcontractorCost([])).toBe(0);
            expect(calcSubcontractorCost(null)).toBe(0);
            expect(calcSubcontractorCost(undefined)).toBe(0);
        });
    });

    describe('calcWeightedProgress', () => {
        it('目標工数で重み付けした平均になる（単純平均ではない）', () => {
            // 目標90h/進捗100% と 目標10h/進捗0% → 単純平均なら50、加重なら90
            const items = [
                { target: 90, progress: 100 },
                { target: 10, progress: 0 },
            ];
            expect(calcWeightedProgress(items)).toBe(90);
        });

        it('目標合計が0なら0を返す（ゼロ除算しない）', () => {
            expect(calcWeightedProgress([{ target: 0, progress: 50 }])).toBe(0);
        });

        it('空配列は0', () => {
            expect(calcWeightedProgress([])).toBe(0);
        });
    });

    describe('summarizeTaskCosts', () => {
        it('目標・実績・加重進捗・協力業者原価を差し引いた予測損益を返す', () => {
            const items = [
                { target: 30, actual: 10, progress: 50 },  // 予測着地20h → +35000
                { target: 20, actual: 20, progress: 100 }, // 予測着地20h →      0
            ];
            const subs = [{ worker_count: 1, unit_price: 20000 }];
            const result = summarizeTaskCosts(items, 3500, subs);

            expect(result.totalTarget).toBe(50);
            expect(result.totalActual).toBe(30);
            // (50*30 + 100*20) / 50 = 70
            expect(result.overallProgress).toBe(70);
            expect(result.subcontractorCost).toBe(20000);
            // 35000 + 0 - 20000
            expect(result.predictedProfitLoss).toBe(15000);
        });

        it('協力業者を省略した場合も動作する', () => {
            const result = summarizeTaskCosts([{ target: 30, actual: 10, progress: 50 }], 3500);
            expect(result.subcontractorCost).toBe(0);
            expect(result.predictedProfitLoss).toBe(35000);
        });

        it('工種が空なら全て0（進捗もゼロ除算しない）', () => {
            const result = summarizeTaskCosts([], 3500);
            expect(result).toEqual({
                totalTarget: 0,
                totalActual: 0,
                overallProgress: 0,
                subcontractorCost: 0,
                predictedProfitLoss: 0,
            });
        });

        it('AdminApp形とWorkerApp形を正規化すると同じ結果になる', () => {
            // AdminApp: masterData(target) + records(taskId/hours) + progressData
            const adminItems = [{ target: 30, actual: 10, progress: 50 }];
            // WorkerApp: ProjectTasks(target_hours/progress_percentage) + records(project_task_id)
            const workerTasks = [{ target_hours: 30, progress_percentage: 50 }];
            const workerItems = workerTasks.map(t => ({
                target: Number(t.target_hours) || 0,
                actual: 10,
                progress: t.progress_percentage || 0,
            }));

            expect(summarizeTaskCosts(workerItems, 3500)).toEqual(
                summarizeTaskCosts(adminItems, 3500)
            );
        });
    });
});

describe('calculateProjectsSummary', () => {
    it('プロジェクト単位で集計し、元のプロパティを保持する', () => {
        const projects = [{
            id: 1,
            siteName: 'テスト現場',
            status: PROJECT_STATUS.IN_PROGRESS,
            masterData: [{ id: 10, target: 30 }],
            records: [{ taskId: 10, hours: 10 }],
            progressData: { 10: 50 },
            subcontractors: [],
        }];

        const [result] = calculateProjectsSummary(projects, 3500);

        expect(result.id).toBe(1);
        expect(result.siteName).toBe('テスト現場');
        expect(result.totalTarget).toBe(30);
        expect(result.totalActual).toBe(10);
        expect(result.overallProgress).toBe(50);
        expect(result.predictedProfitLoss).toBe(35000);
    });

    it('全体進捗は四捨五入される', () => {
        const projects = [{
            id: 1,
            status: PROJECT_STATUS.IN_PROGRESS,
            masterData: [{ id: 10, target: 3 }, { id: 11, target: 3 }],
            records: [],
            progressData: { 10: 34, 11: 0 },
            subcontractors: [],
        }];
        // (34*3 + 0*3) / 6 = 17
        expect(calculateProjectsSummary(projects, 3500)[0].overallProgress).toBe(17);
    });

    it('完了済みで工種が1件もない場合は進捗100%とみなす', () => {
        const projects = [{
            id: 1,
            status: PROJECT_STATUS.COMPLETED,
            masterData: [],
            records: [],
            progressData: {},
            subcontractors: [],
        }];
        expect(calculateProjectsSummary(projects, 3500)[0].overallProgress).toBe(100);
    });

    it('完了済みでも工種があれば実際の進捗を使う', () => {
        const projects = [{
            id: 1,
            status: PROJECT_STATUS.COMPLETED,
            masterData: [{ id: 10, target: 10 }],
            records: [],
            progressData: { 10: 80 },
            subcontractors: [],
        }];
        expect(calculateProjectsSummary(projects, 3500)[0].overallProgress).toBe(80);
    });

    it('masterData/records/progressData が未定義でも落ちない', () => {
        const [result] = calculateProjectsSummary([{ id: 1, status: PROJECT_STATUS.IN_PROGRESS }], 3500);
        expect(result.totalTarget).toBe(0);
        expect(result.totalActual).toBe(0);
        expect(result.overallProgress).toBe(0);
        expect(result.predictedProfitLoss).toBe(0);
    });

    it('協力業者原価は予測損益から差し引かれる', () => {
        const projects = [{
            id: 1,
            status: PROJECT_STATUS.IN_PROGRESS,
            masterData: [{ id: 10, target: 30 }],
            records: [{ taskId: 10, hours: 10 }],
            progressData: { 10: 50 },
            subcontractors: [{ worker_count: 1, unit_price: 20000 }],
        }];
        // 35000 - 20000
        expect(calculateProjectsSummary(projects, 3500)[0].predictedProfitLoss).toBe(15000);
    });
});
