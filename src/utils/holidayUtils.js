/**
 * 会社休日（CompanyHolidays）の判定・表示に関する共通ロジック。
 *
 * CompanyHolidays.description の値の扱い:
 *   - null / '休日' … 実際の休業日
 *   - '会議' … 会社行事。出勤日なので「休日」として数えない
 *   - それ以外の文字列 … 配置表で自由記入した会社行事（旧 '社員旅行' 含む）。出勤日扱い
 *
 * この判定は配置表・工程表・日報入力・休日カレンダーの複数箇所で使われる。
 * 書き込み側（EditHolidayPopup）と判定側が食い違うと無言でバグるため、
 * 文字列リテラルを直書きせず必ずこのモジュールの定数・関数を経由すること。
 */

/** 会社行事の description 値（休日として数えないもの） */
export const COMPANY_EVENT = {
    MEETING: '会議',
};

/** 通常の休日の description 値 */
export const HOLIDAY_DESCRIPTION = '休日';

/** 定型の会社行事の一覧（自由記入との判別用） */
const PRESET_EVENTS = [COMPANY_EVENT.MEETING];

/** 自由記入の最大文字数 */
export const FREE_TEXT_EVENT_MAX_LENGTH = 20;

/**
 * 登録済み休日レコードが「実際の休業日」かを判定する（曜日は考慮しない）。
 * @param {{ description?: string } | null | undefined} holiday CompanyHolidays のレコード
 * @returns {boolean} レコードが存在し、description が未設定または '休日' なら true
 */
export function isActualHoliday(holiday) {
    if (!holiday) return false;
    return !holiday.description || holiday.description === HOLIDAY_DESCRIPTION;
}

/**
 * 自由記入の会社行事か（休日でも定型行事でもない description を持つ）。
 * @param {{ description?: string } | null | undefined} holiday CompanyHolidays のレコード
 * @returns {boolean}
 */
export function isFreeTextEvent(holiday) {
    return !!holiday && !isActualHoliday(holiday) && !PRESET_EVENTS.includes(holiday.description);
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
};

/** 会社行事以外（通常の休日）の表示スタイル */
const DEFAULT_HOLIDAY_STYLE = { bgColor: '#FECACA', shortLabel: '休', textColor: 'text-red-600' };

/** 自由記入の会社行事の表示スタイル（shortLabel は記入内容の先頭2文字） */
const FREE_TEXT_EVENT_STYLE = { bgColor: '#FDE68A', textColor: 'text-amber-800' };

/**
 * 休日レコードに対応する表示スタイルを返す。
 * @param {{ description?: string } | null | undefined} holiday CompanyHolidays のレコード
 * @returns {{ bgColor: string, shortLabel: string, textColor: string } | null}
 *          レコードがなければ null
 */
export function getHolidayStyle(holiday) {
    if (!holiday) return null;
    if (isActualHoliday(holiday)) return DEFAULT_HOLIDAY_STYLE;
    return EVENT_STYLES[holiday.description]
        || { ...FREE_TEXT_EVENT_STYLE, shortLabel: holiday.description.slice(0, 2) };
}
