/**
 * 会社休日（CompanyHolidays）の判定・表示に関する共通ロジック。
 *
 * CompanyHolidays.description の値の扱い:
 *   - '会議' / '社員旅行' … 会社行事。出勤日なので「休日」として数えない
 *   - それ以外（'休日' など） … 実際の休業日
 *
 * この判定は配置表・工程表・日報入力・休日カレンダーの複数箇所で使われる。
 * 書き込み側（EditHolidayPopup）と判定側が食い違うと無言でバグるため、
 * 文字列リテラルを直書きせず必ずこのモジュールの定数・関数を経由すること。
 */

/** 会社行事の description 値（休日として数えないもの） */
export const COMPANY_EVENT = {
    MEETING: '会議',
    TRIP: '社員旅行',
};

/** 通常の休日の description 値 */
export const HOLIDAY_DESCRIPTION = '休日';

/** 休日として数えない会社行事の一覧 */
const NON_HOLIDAY_EVENTS = [COMPANY_EVENT.MEETING, COMPANY_EVENT.TRIP];

/**
 * 登録済み休日レコードが「実際の休業日」かを判定する（曜日は考慮しない）。
 * @param {{ description?: string } | null | undefined} holiday CompanyHolidays のレコード
 * @returns {boolean} レコードが存在し、会社行事でなければ true
 */
export function isActualHoliday(holiday) {
    return !!(holiday && !NON_HOLIDAY_EVENTS.includes(holiday.description));
}

/**
 * 曜日も含めて休業日かを判定する（日曜は登録の有無にかかわらず休み）。
 * @param {number} dow 曜日 (0=日曜)
 * @param {{ description?: string } | null | undefined} holiday CompanyHolidays のレコード
 * @returns {boolean}
 */
export function isNonWorkingDay(dow, holiday) {
    return dow === 0 || isActualHoliday(holiday);
}

/**
 * 配置表セルでの会社行事/休日の表示スタイル。
 * キーは CompanyHolidays.description の値。
 */
const EVENT_STYLES = {
    [COMPANY_EVENT.MEETING]: { bgColor: '#BAE6FD', shortLabel: '会議', textColor: 'text-sky-700' },
    [COMPANY_EVENT.TRIP]: { bgColor: '#DDD6FE', shortLabel: '旅行', textColor: 'text-violet-700' },
};

/** 会社行事以外（通常の休日）の表示スタイル */
const DEFAULT_HOLIDAY_STYLE = { bgColor: '#FECACA', shortLabel: '休', textColor: 'text-red-600' };

/**
 * 休日レコードに対応する表示スタイルを返す。
 * @param {{ description?: string } | null | undefined} holiday CompanyHolidays のレコード
 * @returns {{ bgColor: string, shortLabel: string, textColor: string } | null}
 *          レコードがなければ null
 */
export function getHolidayStyle(holiday) {
    if (!holiday) return null;
    return EVENT_STYLES[holiday.description] || DEFAULT_HOLIDAY_STYLE;
}
