import { toMinutes, formatTimeDisplay } from './workTimeUtils';
import { getDayOfWeek } from './dateUtils';

/**
 * 日報画面から入力する有給・振休（配置表 Assignments の「現場なし」行）の種別と判定。
 *
 * title は配置表のスケジュール種別（SCHEDULE_TYPES）と、DB 関数
 * save_worker_day_leave / _leave_part / _leave_weight（supabase/migrations/20261116000000_worker_day_leave.sql）
 * と同じ文字列にすること。
 */

export const LEAVE_KIND = Object.freeze({
    PAID: '有給',
    SUBSTITUTE: '振休',
});

export const LEAVE_PART = Object.freeze({
    FULL: 'full',
    AM: 'am',
    PM: 'pm',
});

export const LEAVE_PART_LABEL = Object.freeze({
    [LEAVE_PART.FULL]: '終日',
    [LEAVE_PART.AM]: '午前',
    [LEAVE_PART.PM]: '午後',
});

/** 午前休は 12:00 まで、午後休は 13:00 から（昼休みは夏季・冬季とも 12:00〜13:00） */
export const LEAVE_AM_END = '12:00';
export const LEAVE_PM_START = '13:00';

/** 種別と時間帯から title を作る（終日は '有給'、半日は '有給(午前)' など） */
export const leaveTitle = (kind, part) =>
    part === LEAVE_PART.FULL ? kind : `${kind}(${LEAVE_PART_LABEL[part]})`;

const LEAVE_TYPES = Object.values(LEAVE_KIND).flatMap(kind =>
    Object.values(LEAVE_PART).map(part => ({
        title: leaveTitle(kind, part),
        kind,
        part,
        weight: part === LEAVE_PART.FULL ? 1 : 0.5,
    }))
);

/** 6 種別の title（有給, 有給(午前), 有給(午後), 振休, 振休(午前), 振休(午後)） */
export const LEAVE_TITLES = Object.freeze(LEAVE_TYPES.map(t => t.title));

/**
 * title を種別・時間帯・重み（終日 1 / 半日 0.5）に分ける。有給・振休でなければ null
 * @param {string|null|undefined} title
 * @returns {{ title: string, kind: string, part: string, weight: number } | null}
 */
export const parseLeaveTitle = (title) => LEAVE_TYPES.find(t => t.title === title) || null;

export const isLeaveTitle = (title) => parseLeaveTitle(title) !== null;

export const isSubstituteLeaveTitle = (title) => parseLeaveTitle(title)?.kind === LEAVE_KIND.SUBSTITUTE;

export const isHalfDayLeaveTitle = (title) => {
    const t = parseLeaveTitle(title);
    return !!t && t.part !== LEAVE_PART.FULL;
};

/**
 * 1 日の休みの組み合わせとして正しいか（終日 1 つ、または午前・午後それぞれ 0〜1 つ）。
 * DB 関数 save_worker_day_leave と同じ規則。
 * @param {Array<{title: string}>} entries
 * @returns {string|null} 誤りのメッセージ。正しければ null
 */
export const validateLeaveEntries = (entries) => {
    const parts = [];
    for (const e of entries || []) {
        const t = parseLeaveTitle(e?.title);
        if (!t) return '休みの種別が不正です。';
        if (parts.includes(t.part) || parts.includes(LEAVE_PART.FULL) || (t.part === LEAVE_PART.FULL && parts.length > 0)) {
            return '1日の休みは「終日」1つか、「午前」「午後」それぞれ1つまでです。';
        }
        if (t.kind === LEAVE_KIND.SUBSTITUTE && !e.substitute_for_date) {
            return '振休は振替元（休日に出勤した日）を選んでください。';
        }
        parts.push(t.part);
    }
    return null;
};

/**
 * 時間帯ごとの選択（{ am: { kind, substituteForDate }, pm: ... } または { full: ... }）を
 * 保存用の entries に直す。kind が空の時間帯は休みなし。
 * @param {{ mode: 'none'|'full'|'half', full?: {kind: string, substituteForDate?: string}, am?: {kind: string, substituteForDate?: string}, pm?: {kind: string, substituteForDate?: string} }} form
 * @returns {Array<{ title: string, substitute_for_date: string|null }>}
 */
export const leaveFormToEntries = (form) => {
    if (!form || form.mode === 'none') return [];
    const slots = form.mode === 'full'
        ? [[LEAVE_PART.FULL, form.full]]
        : [[LEAVE_PART.AM, form.am], [LEAVE_PART.PM, form.pm]];
    return slots
        .filter(([, slot]) => slot && slot.kind)
        .map(([part, slot]) => ({
            title: leaveTitle(slot.kind, part),
            substitute_for_date: slot.kind === LEAVE_KIND.SUBSTITUTE ? (slot.substituteForDate || null) : null,
        }));
};

/**
 * 保存済みの休みの行（Assignments）から画面の選択状態を作る。leaveFormToEntries の逆。
 * @param {Array<{ title: string, substitute_for_date?: string|null }>} rows
 */
export const leaveRowsToForm = (rows) => {
    const empty = { kind: '', substituteForDate: '' };
    const form = { mode: 'none', full: { ...empty }, am: { ...empty }, pm: { ...empty } };
    for (const row of rows || []) {
        const t = parseLeaveTitle(row?.title);
        if (!t) continue;
        const slot = { kind: t.kind, substituteForDate: row.substitute_for_date || '' };
        if (t.part === LEAVE_PART.FULL) {
            form.mode = 'full';
            form.full = slot;
        } else {
            if (form.mode !== 'full') form.mode = 'half';
            form[t.part] = slot;
        }
    }
    return form;
};

/** 保存内容が同じか（title と振替元の組の集合で比べる） */
export const isSameLeaveEntries = (a, b) => {
    const key = (list) => (list || [])
        .map(e => `${e.title}|${e.substitute_for_date || ''}`)
        .sort()
        .join(',');
    return key(a) === key(b);
};

const recordRange = (record) => {
    const start = toMinutes(formatTimeDisplay(record?.start_time));
    let end = toMinutes(formatTimeDisplay(record?.end_time));
    if (start === null || end === null) return null;
    if (end <= start) end += 24 * 60; // 日をまたぐ作業
    return { start, end };
};

const hasWork = (record) => recordRange(record) !== null || Number(record?.hours) > 0;

/**
 * 休みと作業実績の食い違いを警告する（保存は止めない）。
 * - 終日の休み: その日に作業実績がある
 * - 午前の休み: 12:00 より前にかかる作業がある
 * - 午後の休み: 13:00 より後にかかる作業がある
 * 時刻のない実績（時間数だけの入力）は、終日の休みのときだけ数える。
 * @param {Array<{title: string}>} leaves その日の休み
 * @param {Array<{start_time?: string|null, end_time?: string|null, hours?: number}>} records その日の作業実績
 * @returns {string[]}
 */
export const getLeaveConflictWarnings = (leaves, records) => {
    const list = records || [];
    const amEnd = toMinutes(LEAVE_AM_END);
    const pmStart = toMinutes(LEAVE_PM_START);
    const warnings = [];
    for (const leave of leaves || []) {
        const t = parseLeaveTitle(leave?.title);
        if (!t) continue;
        if (t.part === LEAVE_PART.FULL) {
            if (list.some(hasWork)) warnings.push(`終日の${t.kind}ですが、作業時間が入力されています。`);
        } else if (t.part === LEAVE_PART.AM) {
            if (list.some(r => { const rg = recordRange(r); return rg && rg.start < amEnd; })) {
                warnings.push(`午前の${t.kind}ですが、${LEAVE_AM_END}より前に作業時間があります。`);
            }
        } else if (list.some(r => { const rg = recordRange(r); return rg && rg.end > pmStart; })) {
            warnings.push(`午後の${t.kind}ですが、${LEAVE_PM_START}より後に作業時間があります。`);
        }
    }
    return warnings;
};

/** 'YYYY-MM-DD' を '11/9(日)' の形にする */
export const formatShortDateWithDow = (dateStr) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
    if (!m) return dateStr || '';
    const dow = getDayOfWeek(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return `${Number(m[2])}/${Number(m[3])}(${dow})`;
};
