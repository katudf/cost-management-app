import { supabase } from './supabase';

/**
 * 「残業・作業手当が承認されました」のお知らせ（作業員画面）に関する操作を集約するモジュール。
 * UIコンポーネントから supabase.from() を直接呼ばず、必ずここを経由する。
 *
 * お知らせの対象: 承認済み（status = 'approved'）で、本人がまだ確認していない（acknowledged_at が NULL）申請。
 * - 自分の申請を自分で承認した場合は、承認と同時に確認済みになる（DB 関数 approve_*）。
 * - 承認後に時間・対象作業が変わって承認待ちに戻ると、確認済みも外れる（次の承認でまた知らせる）。
 * - 確認済みにするのは DB 関数 acknowledge_approvals（worker ロールは承認テーブルに直接書けないため）。
 */

/**
 * 本人がまだ確認していない承認済みの申請を取得する。
 * @param {string} workerName
 * @returns {Promise<{ kind: 'overtime'|'allowance', id: number, project_id: number, date: string,
 *   approved_by: string|null, approved_at: string|null, hours?: number, task_names?: string[] }[]>}
 *   日付の新しい順（同じ日は残業 → 作業手当の順）
 */
export async function fetchUnacknowledgedApprovals(workerName) {
    if (!workerName) return [];
    const [overtime, allowance] = await Promise.all([
        supabase.from('OvertimeApprovals')
            .select('id, project_id, date, approved_hours, approved_by, approved_at')
            .eq('worker_name', workerName)
            .eq('status', 'approved')
            .is('acknowledged_at', null),
        supabase.from('WorkAllowanceApprovals')
            .select('id, project_id, date, approved_task_names, approved_by, approved_at')
            .eq('worker_name', workerName)
            .eq('status', 'approved')
            .is('acknowledged_at', null),
    ]);
    if (overtime.error) throw overtime.error;
    if (allowance.error) throw allowance.error;

    const notices = [
        ...(overtime.data || []).map(a => ({
            kind: 'overtime',
            id: a.id,
            project_id: a.project_id,
            date: a.date,
            approved_by: a.approved_by,
            approved_at: a.approved_at,
            hours: Number(a.approved_hours) || 0,
        })),
        ...(allowance.data || []).map(a => ({
            kind: 'allowance',
            id: a.id,
            project_id: a.project_id,
            date: a.date,
            approved_by: a.approved_by,
            approved_at: a.approved_at,
            task_names: a.approved_task_names || [],
        })),
    ];
    const kindOrder = { overtime: 0, allowance: 1 };
    return notices.sort((a, b) =>
        (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || kindOrder[a.kind] - kindOrder[b.kind]
    );
}

/**
 * お知らせを本人が確認したことを記録する（DB 関数 acknowledge_approvals）。
 * @param {object} params
 * @param {string} params.workerName - 本人の作業員名
 * @param {number} params.workerId   - 本人の作業員 ID（名前との組み合わせを DB で照合する）
 * @param {{ kind: string, id: number }[]} params.notices - 確認したお知らせ
 */
export async function acknowledgeApprovals({ workerName, workerId, notices }) {
    const idsOf = (kind) => (notices || []).filter(n => n.kind === kind).map(n => n.id);
    const { error } = await supabase.rpc('acknowledge_approvals', {
        p_worker_name: workerName,
        p_worker_id: workerId ?? null,
        p_overtime_ids: idsOf('overtime'),
        p_allowance_ids: idsOf('allowance'),
    });
    if (error) throw error;
}
