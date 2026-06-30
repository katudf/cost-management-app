import { supabase } from './supabase';

/**
 * 残業承認（OvertimeApprovals）に関する操作を集約するモジュール。
 * UIコンポーネントから supabase.from() を直接呼ばず、必ずここを経由する。
 *
 * 承認単位: 日次 × 作業員(worker_name) × 現場(project_id) で1件。
 * 申請起票: 日報保存時、残業合計 > 0 で pending を自動起票（既存があれば更新）。
 * 承認: 職長が自現場の pending を承認（自己承認可）。
 * 再承認: 承認後に残業合計が変わったら pending に戻す（approved_hours で差分検知）。
 */

/**
 * 日報保存後に呼び出し、残業申請を同期する。
 * @param {Object} params
 * @param {number|string} params.projectId
 * @param {string} params.workerName
 * @param {string} params.date            - 'YYYY-MM-DD'
 * @param {number} params.overtimeTotal   - その日・その現場・その作業員の残業合計(h)
 * @param {string} [params.reason]         - 残業理由（任意）
 */
export async function syncOvertimeApproval({ projectId, workerName, date, overtimeTotal, reason }) {
    const pid = Number(projectId);

    // 残業がゼロになった場合は申請レコードを削除（承認済みでも消す＝残業実態が無いため）
    if (!overtimeTotal || overtimeTotal <= 0) {
        const { error } = await supabase
            .from('OvertimeApprovals')
            .delete()
            .eq('project_id', pid)
            .eq('worker_name', workerName)
            .eq('date', date);
        if (error) throw error;
        return;
    }

    // 既存レコードを確認
    const { data: existing, error: fetchError } = await supabase
        .from('OvertimeApprovals')
        .select('*')
        .eq('project_id', pid)
        .eq('worker_name', workerName)
        .eq('date', date)
        .maybeSingle();
    if (fetchError) throw fetchError;

    const reasonVal = reason != null ? reason : (existing?.reason ?? null);

    if (!existing) {
        // 新規申請
        const { error } = await supabase.from('OvertimeApprovals').insert({
            project_id: pid,
            worker_name: workerName,
            date,
            status: 'pending',
            requested_hours: overtimeTotal,
            reason: reasonVal,
        });
        if (error) throw error;
        return;
    }

    // 承認済みで残業合計が変わった → pending に戻す（再承認要求）
    const approvedHoursChanged =
        existing.status === 'approved' &&
        Number(existing.approved_hours) !== Number(overtimeTotal);

    const updatePayload = {
        requested_hours: overtimeTotal,
        reason: reasonVal,
        updated_at: new Date().toISOString(),
    };

    if (approvedHoursChanged) {
        updatePayload.status = 'pending';
        updatePayload.approved_by = null;
        updatePayload.approved_at = null;
        updatePayload.approved_hours = null;
    }

    const { error } = await supabase
        .from('OvertimeApprovals')
        .update(updatePayload)
        .eq('id', existing.id);
    if (error) throw error;
}

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
 * 残業申請を承認する。
 * @param {number} id            - OvertimeApprovals.id
 * @param {string} approverName  - 承認者（職長）名
 */
export async function approveOvertime(id, approverName) {
    // requested_hours を承認時点の approved_hours として確定する
    const { data: row, error: fetchError } = await supabase
        .from('OvertimeApprovals')
        .select('requested_hours')
        .eq('id', id)
        .single();
    if (fetchError) throw fetchError;

    const { error } = await supabase
        .from('OvertimeApprovals')
        .update({
            status: 'approved',
            approved_by: approverName,
            approved_at: new Date().toISOString(),
            approved_hours: row.requested_hours,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    if (error) throw error;
}

/**
 * 既存の残業理由を取得する（その現場・その日・その作業員）。編集時の初期表示用。
 * @param {number|string} projectId
 * @param {string} workerName
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {Promise<string>} 理由文字列（無ければ空文字）
 */
export async function fetchApprovalReason(projectId, workerName, date) {
    const { data, error } = await supabase
        .from('OvertimeApprovals')
        .select('reason')
        .eq('project_id', Number(projectId))
        .eq('worker_name', workerName)
        .eq('date', date)
        .maybeSingle();
    if (error) throw error;
    return data?.reason || '';
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
