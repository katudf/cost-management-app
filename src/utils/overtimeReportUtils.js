import { splitRecordOvertime } from './workTimeUtils';

/**
 * 週報（PDF / Excel）の「作業手当」欄に出す、その日の早出・残業の行と承認者名を作る。
 *
 * - 早出（定時開始前）は職長の承認が要らないので、「（未承認）」を付けない。
 * - 残業（定時終了後）は、残業がある現場のうち1つでも承認されていなければ「（未承認）」を付ける。
 * - 承認サインには、その日の承認済みの残業を承認した職長名を出す。
 *
 * @param {object[]} dayRecords        その日の TaskRecords（overtime_hours / early_overtime_hours / project_id）
 * @param {string} date                'YYYY-MM-DD'
 * @param {object[]} overtimeApprovals OvertimeApprovals の行
 * @returns {{ lines: string[], approverName: string }}
 */
export function buildDayOvertimeLines(dayRecords, date, overtimeApprovals = []) {
    const splits = (dayRecords || []).map(r => ({ projectId: String(r.project_id), ...splitRecordOvertime(r) }));
    const early = splits.reduce((sum, s) => sum + s.early, 0);
    const late = splits.reduce((sum, s) => sum + s.late, 0);

    const lines = [];
    let approverName = '';
    if (early > 0) lines.push(`早出 ${early.toFixed(1)}H`);
    if (late > 0) {
        const lateProjectIds = [...new Set(splits.filter(s => s.late > 0).map(s => s.projectId))];
        const approvedFor = (pid) => (overtimeApprovals || []).find(a =>
            String(a.project_id) === pid && a.date === date && a.status === 'approved'
        );
        const hasUnapproved = lateProjectIds.some(pid => !approvedFor(pid));
        lines.push(`残業 ${late.toFixed(1)}H${hasUnapproved ? '（未承認）' : ''}`);

        const approvedRow = lateProjectIds.map(approvedFor).find(a => a?.approved_by);
        if (approvedRow) approverName = approvedRow.approved_by;
    }
    return { lines, approverName };
}
