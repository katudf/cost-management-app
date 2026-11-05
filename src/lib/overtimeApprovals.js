import { supabase } from './supabase';

/**
 * 残業承認（OvertimeApprovals）に関する操作を集約するモジュール。
 * UIコンポーネントから supabase.from() を直接呼ばず、必ずここを経由する。
 *
 * 承認単位: 日次 × 作業員(worker_name) × 現場(project_id) で1件。
 * 対象: 残業（定時終了後の時間外）だけ。早出（定時開始前）は承認不要なので申請に含めない。
 * 申請起票: 日報保存時、残業合計 > 0 で pending を自動起票（既存があれば更新）。
 *           起票・更新・削除は DB 関数 save_daily_report が日報と同じトランザクションで行う。
 * 承認: 職長が自現場の pending を承認（自己承認可）。
 * 再承認: 承認後に残業合計が変わったら pending に戻す（approved_hours で差分検知）。
 */

/**
 * 職長が担当する現場の承認待ち残業を取得する。
 * @param {number[]} projectIds - 職長が foreman を務める現場ID配列
 * @returns {Promise<Array>}
 */
export async function fetchPendingApprovals(projectIds) {
    if (!projectIds || projectIds.length === 0) return [];
    const { data, error } = await supabase
        .from('OvertimeApprovals')
        .select('*')
        .in('project_id', projectIds.map(Number))
        .eq('status', 'pending')
        .order('date', { ascending: true });
    if (error) throw error;
    return data || [];
}

/**
 * 残業申請を承認する（DB 関数 approve_overtime）。
 * worker ロールは承認テーブルに直接書けないため、職長かどうかを DB 側で確認する RPC を使う。
 * @param {number} id                 - OvertimeApprovals.id
 * @param {string} approverName       - 承認者（職長）名
 * @param {number} [approverWorkerId] - 承認者の作業員 ID（職長判定用）
 */
export async function approveOvertime(id, approverName, approverWorkerId) {
    const { error } = await supabase.rpc('approve_overtime', {
        p_id: id,
        p_approver_name: approverName,
        p_approver_worker_id: approverWorkerId ?? null,
    });
    if (error) throw error;
}

/**
 * その現場・その日・その作業員の残業申請を取得する。編集時の理由の初期表示と、
 * 送信で承認済みの残業が承認待ちに戻ったかの判定に使う。
 * @param {number|string} projectId
 * @param {string} workerName
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {Promise<{ reason: string, status: string|null, approved_hours: number|null }>}
 *   申請が無ければ { reason: '', status: null, approved_hours: null }
 */
export async function fetchDayOvertimeApproval(projectId, workerName, date) {
    const { data, error } = await supabase
        .from('OvertimeApprovals')
        .select('reason, status, approved_hours')
        .eq('project_id', Number(projectId))
        .eq('worker_name', workerName)
        .eq('date', date)
        .maybeSingle();
    if (error) throw error;
    return {
        reason: data?.reason || '',
        status: data?.status ?? null,
        approved_hours: data?.approved_hours == null ? null : Number(data.approved_hours),
    };
}

/**
 * 帳票出力用: 指定作業員の期間内の承認レコードを取得する。
 * @param {string} workerName
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate   - 'YYYY-MM-DD'
 * @returns {Promise<Array>}
 */
export async function fetchApprovalsForReport(workerName, startDate, endDate) {
    const { data, error } = await supabase
        .from('OvertimeApprovals')
        .select('*')
        .eq('worker_name', workerName)
        .gte('date', startDate)
        .lte('date', endDate);
    if (error) throw error;
    return data || [];
}
