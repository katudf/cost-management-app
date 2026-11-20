import { supabase } from './supabase';
import { isMissingRpcError } from '../utils/supabaseErrors';

/**
 * 作業手当承認（WorkAllowanceApprovals）に関する操作を集約するモジュール。
 * UIコンポーネントから supabase.from() を直接呼ばず、必ずここを経由する。
 *
 * 承認単位: 日次 × 作業員(worker_name) × 現場(project_id) で1件。
 * 申請起票: 日報保存時、work_allowanceチェック済みの工種が1件以上あれば pending を自動起票（既存があれば更新）。
 *           起票・更新・削除は DB 関数 save_daily_report が日報と同じトランザクションで行う。
 * 承認: 職長が自現場の pending を承認（自己承認可）。
 * 再承認: 承認後に対象工種の組み合わせが変わったら pending に戻す（approved_task_names で差分検知）。
 */

/**
 * 職長が担当する現場の承認待ち作業手当を取得する。
 * 各申請には対象工種ごとの作業時間（task_hours: { [工種名]: 時間 }）を付与する。
 * @param {number[]} projectIds - 職長が foreman を務める現場ID配列
 * @returns {Promise<Array>}
 */
export async function fetchPendingWorkAllowanceApprovals(projectIds) {
    if (!projectIds || projectIds.length === 0) return [];
    const { data, error } = await supabase
        .from('WorkAllowanceApprovals')
        .select('*')
        .in('project_id', projectIds.map(Number))
        .eq('status', 'pending')
        .order('date', { ascending: true });
    if (error) throw error;
    const approvals = data || [];
    if (approvals.length === 0) return [];

    // 対象工種の時間を TaskRecords から集計して付与する
    const dates = [...new Set(approvals.map(a => a.date))];
    const workerNames = [...new Set(approvals.map(a => a.worker_name))];
    const { data: taskRecords, error: trError } = await supabase
        .from('TaskRecords')
        .select('project_id, worker_name, date, hours, work_allowance, ProjectTasks(name)')
        .in('project_id', projectIds.map(Number))
        .in('date', dates)
        .in('worker_name', workerNames)
        .eq('work_allowance', true);
    if (trError) throw trError;

    return approvals.map(a => {
        const taskHours = {};
        (taskRecords || []).forEach(r => {
            if (
                String(r.project_id) === String(a.project_id) &&
                r.worker_name === a.worker_name &&
                r.date === a.date
            ) {
                const taskName = r.ProjectTasks?.name || '不明な作業';
                taskHours[taskName] = (taskHours[taskName] || 0) + Number(r.hours || 0);
            }
        });
        return { ...a, task_hours: taskHours };
    });
}

/**
 * 作業手当申請を承認する（DB 関数 approve_work_allowance）。
 * worker ロールは承認テーブルに直接書けないため、職長かどうかを DB 側で確認する RPC を使う。
 *
 * 職長が一覧で見た申請（対象の作業と更新日時）を渡すと、その後に作業員が直していたとき承認せずに
 * 競合のエラー（code 'PT409'）になる。作業の時間が変わった保存でも更新日時が進むので検知できる
 * （docs/specs/daily-report-db-hardening.md §4.6 DB-6）。
 * 見た値を受け取る DB 関数が無い（マイグレーション 20261120010000 の適用前）ときは、見た値を渡さずに呼び直す。
 * @param {number} id                 - WorkAllowanceApprovals.id
 * @param {string} approverName       - 承認者（職長）名
 * @param {number} [approverWorkerId] - 承認者の作業員 ID（職長判定用）
 * @param {{ task_names?: string[]|null, updated_at?: string|null }} [seen] - 一覧で見た申請
 */
export async function approveWorkAllowance(id, approverName, approverWorkerId, seen) {
    const base = {
        p_id: id,
        p_approver_name: approverName,
        p_approver_worker_id: approverWorkerId ?? null,
    };
    const expected = {};
    if (Array.isArray(seen?.task_names)) expected.p_expected_task_names = seen.task_names;
    if (seen?.updated_at) expected.p_expected_updated_at = seen.updated_at;
    let { error } = await supabase.rpc('approve_work_allowance', { ...base, ...expected });
    if (isMissingRpcError(error) && Object.keys(expected).length > 0) {
        ({ error } = await supabase.rpc('approve_work_allowance', base));
    }
    if (error) throw error;
}

/**
 * 帳票出力用: 指定作業員の期間内の承認レコードを取得する。
 * @param {string} workerName
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate   - 'YYYY-MM-DD'
 * @returns {Promise<Array>}
 */
export async function fetchWorkAllowanceApprovalsForReport(workerName, startDate, endDate) {
    const { data, error } = await supabase
        .from('WorkAllowanceApprovals')
        .select('*')
        .eq('worker_name', workerName)
        .gte('date', startDate)
        .lte('date', endDate);
    if (error) throw error;
    return data || [];
}
