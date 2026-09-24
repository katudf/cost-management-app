import { supabase } from '../lib/supabase';
import { toDateStr, addDays, getMonday } from '../utils/dateUtils';
import { fetchApprovalsForReport } from '../lib/overtimeApprovals';
import { fetchWorkAllowanceApprovalsForReport } from '../lib/workAllowanceApprovals';
import { fetchCompanyHolidays } from './useCompanyHolidays';

/**
 * 週報（日報の週次出力）のデータ収集を一箇所に集約するモジュール。
 *
 * 以前は AdminApp の Excel 出力 / PDF 出力 / WorkerApp の PDF 出力の
 * 3箇所に同じクエリがコピーされていた（フェーズ2 手順5）。
 *
 * 出力形式の選択・トースト通知・ローディング表示は呼び出し側の責務とし、
 * ここではデータの収集だけを行う（手順2で確立した規約）。
 */

/**
 * 週の起点から7日分の日付文字列（YYYY-MM-DD）を生成する。
 *
 * 日付文字列はローカルタイム基準（`toDateStr`）で生成する。
 * `Date#toISOString()` は UTC 変換を伴うため、ローカルの Date を渡すと
 * JST(UTC+9) では1日前にずれる。
 *
 * @param {Date|string|number} start 週の起点。
 * @param {{ alignToMonday?: boolean }} [options]
 *   `alignToMonday` が true の場合、`start` を含む週の月曜まで巻き戻す。
 *   既に月曜であることが保証されている場合は false（既定）。
 * @returns {string[]} 7日分の 'YYYY-MM-DD'
 */
export const buildWeekDays = (start, { alignToMonday = false } = {}) => {
    const base = alignToMonday ? getMonday(start) : new Date(start);
    return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(base, i)));
};

/**
 * 週報の weekPrefix（YYYYMMDD）を日付文字列から作る。
 * @param {string} dayStr 'YYYY-MM-DD'
 */
export const buildWeekPrefix = (dayStr) => dayStr.replace(/-/g, '').slice(0, 8);

/**
 * 1名分の週報データを収集する。
 *
 * 承認情報の取得失敗は週報全体を止めるほどのものではないため、
 * 空配列にフォールバックしてログのみ残す（従来の3コピーと同じ挙動）。
 *
 * @param {object} params
 * @param {string} params.workerName 対象作業員名
 * @param {string[]} params.days `buildWeekDays` の戻り値
 * @param {Array} params.projects 全プロジェクト
 * @param {number|string} [params.foremanWorkerId]
 *   職長判定に使う作業員ID。未指定なら `workers` から名前で引く。
 * @param {Array} [params.workers] 作業員マスタ（`foremanWorkerId` 省略時に使用）
 * @returns {Promise<object>} 出力関数に渡す1名分のデータ
 */
export const fetchWorkerReportData = async ({
    workerName,
    days,
    projects = [],
    foremanWorkerId,
    workers = [],
}) => {
    const { data: recordsData, error: recordsError } = await supabase
        .from('TaskRecords')
        .select('*, ProjectTasks(name, projectId)')
        .eq('worker_name', workerName)
        .gte('date', days[0])
        .lte('date', days[6]);
    if (recordsError) throw recordsError;

    const resolvedForemanId = foremanWorkerId !== undefined
        ? foremanWorkerId
        : workers.find(w => w.name === workerName)?.id;

    const foremanProjectIds = projects
        .filter(p => p.foreman_worker_id === resolvedForemanId)
        .map(p => p.id);

    let subcontractorsData = [];
    if (foremanProjectIds.length > 0) {
        const { data: subData, error: subError } = await supabase
            .from('SubcontractorRecords')
            .select('*')
            .in('project_id', foremanProjectIds)
            .gte('date', days[0])
            .lte('date', days[6]);
        if (subError) throw subError;
        if (subData) subcontractorsData = subData;
    }

    // 残業承認状況（未承認の判定に使用）
    let overtimeApprovals = [];
    try {
        overtimeApprovals = await fetchApprovalsForReport(workerName, days[0], days[6]);
    } catch (e) { console.error('Failed to fetch overtime approvals:', e); }

    // 作業手当承認状況（未承認の判定に使用）
    let workAllowanceApprovals = [];
    try {
        workAllowanceApprovals = await fetchWorkAllowanceApprovalsForReport(workerName, days[0], days[6]);
    } catch (e) { console.error('Failed to fetch work allowance approvals:', e); }

    // 配置表の現場なし割当（有給 / 休み 等）。実績のない日に区分を表示するために使う
    let leaveAssignments = [];
    if (resolvedForemanId !== undefined && resolvedForemanId !== null) {
        const { data: asgData, error: asgError } = await supabase
            .from('Assignments')
            .select('workerId, date, projectId, title')
            .eq('workerId', resolvedForemanId)
            .is('projectId', null)
            .gte('date', days[0])
            .lte('date', days[6]);
        if (asgError) console.error('Failed to fetch leave assignments:', asgError);
        else leaveAssignments = asgData || [];
    }

    // 会社カレンダーの休日（実績のない日に「休日」を表示するために使う）
    let companyHolidays = [];
    try {
        companyHolidays = await fetchCompanyHolidays({ from: days[0], to: days[6] });
    } catch (e) { console.error('Failed to fetch company holidays:', e); }

    return {
        workerName,
        days,
        recordsData: recordsData || [],
        projects,
        subcontractorsData,
        overtimeApprovals,
        workAllowanceApprovals,
        leaveAssignments,
        companyHolidays,
    };
};

/**
 * 複数名分の週報データをまとめて収集する。
 * 戻り値はそのまま `generateMultipleWorkersReportExcel` /
 * `generateMultipleWorkersReportPDF` の第1引数に渡せる。
 *
 * @param {object} params
 * @param {string[]} params.workerNames
 * @param {string[]} params.days
 * @param {Array} params.projects
 * @param {Array} [params.workers]
 * @returns {Promise<Array>} workersDataList
 */
export const fetchWeeklyReportData = async ({
    workerNames,
    days,
    projects = [],
    workers = [],
}) => {
    const workersDataList = [];
    for (const workerName of workerNames) {
        workersDataList.push(await fetchWorkerReportData({
            workerName,
            days,
            projects,
            workers,
        }));
    }
    return workersDataList;
};
