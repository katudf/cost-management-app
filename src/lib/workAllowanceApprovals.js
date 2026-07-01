import { supabase } from './supabase';

/**
 * 作業手当承認（WorkAllowanceApprovals）に関する操作を集約するモジュール。
 * UIコンポーネントから supabase.from() を直接呼ばず、必ずここを経由する。
 *
 * 承認単位: 日次 × 作業員(worker_name) × 現場(project_id) で1件。
 * 申請起票: 日報保存時、work_allowanceチェック済みの工種が1件以上あれば pending を自動起票（既存があれば更新）。
 * 承認: 職長が自現場の pending を承認（自己承認可）。
 * 再承認: 承認後に対象工種の組み合わせが変わったら pending に戻す（approved_task_names で差分検知）。
 */

/**
 * 日報保存後に呼び出し、作業手当申請を同期する。
 * @param {Object} params
 * @param {number|string} params.projectId
 * @param {string} params.workerName
 * @param {string} params.date       - 'YYYY-MM-DD'
 * @param {string[]} params.taskNames - その日・その現場・その作業員で作業手当にチェックされた工種名
 */
export async function syncWorkAllowanceApproval({ projectId, workerName, date, taskNames }) {
    const pid = Number(projectId);
    const names = (taskNames || []).filter(Boolean);

    // 対象工種が無くなった場合は申請レコードを削除（承認済みでも消す＝手当対象の実態が無いため）
    if (names.length === 0) {
        const { error } = await supabase
            .from('WorkAllowanceApprovals')
            .delete()
            .eq('project_id', pid)
            .eq('worker_name', workerName)
            .eq('date', date);
        if (error) throw error;
        return;
    }

    // 既存レコードを確認
    const { data: existing, error: fetchError } = await supabase
        .from('WorkAllowanceApprovals')
        .select('*')
        .eq('project_id', pid)
        .eq('worker_name', workerName)
        .eq('date', date)
        .maybeSingle();
    if (fetchError) throw fetchError;

    if (!existing) {
        // 新規申請
        const { error } = await supabase.from('WorkAllowanceApprovals').insert({
            project_id: pid,
            worker_name: workerName,
            date,
            status: 'pending',
            task_names: names,
        });
        if (error) throw error;
        return;
    }

    // 承認済みで対象工種の組み合わせが変わった → pending に戻す（再承認要求）
    const sortedNew = [...names].sort();
    const sortedApproved = [...(existing.approved_task_names || [])].sort();
    const taskNamesChanged =
        existing.status === 'approved' &&
        JSON.stringify(sortedNew) !== JSON.stringify(sortedApproved);

    const updatePayload = {
        task_names: names,
        updated_at: new Date().toISOString(),
    };

    if (taskNamesChanged) {
        updatePayload.status = 'pending';
        updatePayload.approved_by = null;
        updatePayload.approved_at = null;
        updatePayload.approved_task_names = null;
    }

    const { error } = await supabase
        .from('WorkAllowanceApprovals')
        .update(updatePayload)
        .eq('id', existing.id);
    if (error) throw error;
}

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
 * 作業手当申請を承認する。
 * @param {number} id            - WorkAllowanceApprovals.id
 * @param {string} approverName  - 承認者（職長）名
 */
export async function approveWorkAllowance(id, approverName) {
    // task_names を承認時点の approved_task_names として確定する
    const { data: row, error: fetchError } = await supabase
        .from('WorkAllowanceApprovals')
        .select('task_names')
        .eq('id', id)
        .single();
    if (fetchError) throw fetchError;

    const { error } = await supabase
        .from('WorkAllowanceApprovals')
        .update({
            status: 'approved',
            approved_by: approverName,
            approved_at: new Date().toISOString(),
            approved_task_names: row.task_names,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);
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
