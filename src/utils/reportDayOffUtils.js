import { SCHEDULE_TYPES } from './constants';
import { isActualHoliday, HOLIDAY_DESCRIPTION } from './holidayUtils';

/**
 * 就労日報（Excel / PDF）で「作業実績のない日」に表示する区分ラベルを決める。
 *
 * 優先順位:
 *   1. その日に作業実績（TaskRecords）がある → null（作業内容をそのまま表示する）
 *   2. 配置表のスケジュール種別（有給 / 休み / 健診 など）→ その title
 *   3. 会社カレンダーの休日 → '休日'、会社行事（会議 / 社員旅行）→ 行事名
 *   4. どれでもない → null
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {object} params
 * @param {boolean} params.hasRecords その日に作業実績があるか
 * @param {Array<{date: string, title?: string, projectId?: any}>} [params.leaveAssignments]
 *        配置表の現場なし割当（projectId が null の行）
 * @param {Array<{date: string, description?: string|null}>} [params.companyHolidays]
 * @returns {string|null}
 */
export const getReportDayOffLabel = (date, { hasRecords, leaveAssignments = [], companyHolidays = [] }) => {
    if (hasRecords) return null;

    const schedule = (leaveAssignments || []).find(a =>
        a.date === date && !a.projectId && SCHEDULE_TYPES.some(s => s.title === a.title)
    );
    if (schedule) return schedule.title;

    const holiday = (companyHolidays || []).find(h => h.date === date);
    if (!holiday) return null;
    return isActualHoliday(holiday) ? HOLIDAY_DESCRIPTION : holiday.description;
};
