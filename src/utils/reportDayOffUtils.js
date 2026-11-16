import { SCHEDULE_TYPES } from './constants';
import { isActualHoliday, HOLIDAY_DESCRIPTION } from './holidayUtils';
import { isHalfDayLeaveTitle, isSubstituteLeaveTitle, parseLeaveTitle, LEAVE_PART, LEAVE_PART_LABEL, formatShortDateWithDow } from './leaveUtils';

const isScheduleOn = (date) => (a) =>
    a.date === date && !a.projectId && SCHEDULE_TYPES.some(s => s.title === a.title);

/**
 * 就労日報（Excel / PDF）で「作業実績のない日」に表示する区分ラベルを決める。
 *
 * 優先順位:
 *   1. その日に作業実績（TaskRecords）がある → null（作業内容をそのまま表示する）
 *   2. 配置表のスケジュール種別（有給 / 休み / 健診 など）→ その title（複数あれば「・」でつなぐ。例: 有給(午前)・振休(午後)）
 *   3. 会社カレンダーの休日 → '休日'、会社行事（会議 / 自由記入）→ 行事名
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

    const schedules = (leaveAssignments || []).filter(isScheduleOn(date));
    if (schedules.length > 0) return [...new Set(schedules.map(a => a.title))].join('・');

    const holiday = (companyHolidays || []).find(h => h.date === date);
    if (!holiday) return null;
    return isActualHoliday(holiday) ? HOLIDAY_DESCRIPTION : holiday.description;
};

/**
 * 作業実績のある日の半日休（有給(午前) / 振休(午後) など）のラベル。
 * 就労日報では、その日の空いている現場欄に表示する（作業実績のない日は getReportDayOffLabel が出す）。
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {object} params
 * @param {boolean} params.hasRecords その日に作業実績があるか
 * @param {Array<{date: string, title?: string, projectId?: any}>} [params.leaveAssignments]
 * @returns {string|null} 例: '有給(午前)'。複数あれば「・」でつなぐ
 */
export const getReportHalfDayLeaveLabel = (date, { hasRecords, leaveAssignments = [] }) => {
    if (!hasRecords) return null;
    const halves = (leaveAssignments || []).filter(a => isScheduleOn(date)(a) && isHalfDayLeaveTitle(a.title));
    if (halves.length === 0) return null;
    return [...new Set(halves.map(a => a.title))].join('・');
};

/**
 * 振休の振替元の文言。就労日報では休みの区分を出した現場欄の「作業内容」に表示する。
 * 振替元のない振休（配置表から入れたもの）は出さない。
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {object} params
 * @param {Array<{date: string, title?: string, projectId?: any, substitute_for_date?: string|null}>} [params.leaveAssignments]
 * @param {boolean} [params.halfDayOnly=false] 半日の振休だけを対象にする（作業実績のある日）
 * @returns {string[]} 1 行ずつ。例: ['振替元 11/8(日)']、半日が 2 つなら ['振替元(午前) 11/1(日)', '振替元(午後) 11/8(日)']
 */
export const getReportSubstituteNotes = (date, { leaveAssignments = [], halfDayOnly = false } = {}) => {
    const subs = (leaveAssignments || []).filter(a =>
        isScheduleOn(date)(a) && isSubstituteLeaveTitle(a.title) && a.substitute_for_date
        && (!halfDayOnly || isHalfDayLeaveTitle(a.title))
    );
    const withPart = subs.length > 1;
    return subs.map(a => {
        const part = parseLeaveTitle(a.title).part;
        const label = withPart && part !== LEAVE_PART.FULL ? `振替元(${LEAVE_PART_LABEL[part]})` : '振替元';
        return `${label} ${formatShortDateWithDow(a.substitute_for_date)}`;
    });
};
