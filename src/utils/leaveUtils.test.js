import { describe, it, expect } from 'vitest';
import {
    LEAVE_KIND, LEAVE_PART, LEAVE_TITLES,
    leaveTitle, parseLeaveTitle, isSubstituteLeaveTitle, isHalfDayLeaveTitle,
    validateLeaveEntries, leaveFormToEntries, leaveRowsToForm, isSameLeaveEntries,
    getLeaveConflictWarnings, formatShortDateWithDow,
} from './leaveUtils';
import { SCHEDULE_TYPES } from './constants';

describe('有給・振休の種別', () => {
    it('6 種別の title を作り、配置表のスケジュール種別にすべて含まれる', () => {
        expect(LEAVE_TITLES).toEqual(['有給', '有給(午前)', '有給(午後)', '振休', '振休(午前)', '振休(午後)']);
        LEAVE_TITLES.forEach(title => {
            expect(SCHEDULE_TYPES.some(s => s.title === title)).toBe(true);
        });
    });

    it('title を種別・時間帯・重みに分ける', () => {
        expect(leaveTitle(LEAVE_KIND.PAID, LEAVE_PART.AM)).toBe('有給(午前)');
        expect(parseLeaveTitle('振休(午後)')).toMatchObject({ kind: '振休', part: 'pm', weight: 0.5 });
        expect(parseLeaveTitle('有給')).toMatchObject({ kind: '有給', part: 'full', weight: 1 });
        expect(parseLeaveTitle('健診')).toBeNull();
        expect(isSubstituteLeaveTitle('振休')).toBe(true);
        expect(isSubstituteLeaveTitle('有給(午前)')).toBe(false);
        expect(isHalfDayLeaveTitle('有給(午前)')).toBe(true);
        expect(isHalfDayLeaveTitle('有給')).toBe(false);
    });
});

describe('validateLeaveEntries', () => {
    it('終日 1 つ、または午前・午後それぞれ 1 つまで', () => {
        expect(validateLeaveEntries([])).toBeNull();
        expect(validateLeaveEntries([{ title: '有給' }])).toBeNull();
        expect(validateLeaveEntries([{ title: '有給(午前)' }, { title: '振休(午後)', substitute_for_date: '2026-11-08' }])).toBeNull();
        expect(validateLeaveEntries([{ title: '有給' }, { title: '有給(午後)' }])).toMatch(/終日/);
        expect(validateLeaveEntries([{ title: '有給(午前)' }, { title: '振休(午前)', substitute_for_date: '2026-11-08' }])).toMatch(/午前/);
        expect(validateLeaveEntries([{ title: '健診' }])).toMatch(/種別/);
    });

    it('振休は振替元が必須', () => {
        expect(validateLeaveEntries([{ title: '振休' }])).toMatch(/振替元/);
    });
});

describe('画面の選択と保存内容の変換', () => {
    it('終日・半日・なしを保存内容に直す', () => {
        expect(leaveFormToEntries({ mode: 'none' })).toEqual([]);
        expect(leaveFormToEntries({ mode: 'full', full: { kind: '有給' } }))
            .toEqual([{ title: '有給', substitute_for_date: null }]);
        expect(leaveFormToEntries({
            mode: 'half',
            am: { kind: '振休', substituteForDate: '2026-11-08' },
            pm: { kind: '' },
        })).toEqual([{ title: '振休(午前)', substitute_for_date: '2026-11-08' }]);
    });

    it('有給には振替元を付けない', () => {
        expect(leaveFormToEntries({ mode: 'full', full: { kind: '有給', substituteForDate: '2026-11-08' } }))
            .toEqual([{ title: '有給', substitute_for_date: null }]);
    });

    it('保存済みの行から選択状態を作る（往復で同じ内容に戻る）', () => {
        const rows = [
            { title: '有給(午前)', substitute_for_date: null },
            { title: '振休(午後)', substitute_for_date: '2026-11-08' },
            { title: '健診' },
        ];
        const form = leaveRowsToForm(rows);
        expect(form.mode).toBe('half');
        expect(form.am).toEqual({ kind: '有給', substituteForDate: '' });
        expect(form.pm).toEqual({ kind: '振休', substituteForDate: '2026-11-08' });
        expect(isSameLeaveEntries(leaveFormToEntries(form), rows.slice(0, 2))).toBe(true);
        expect(leaveRowsToForm([]).mode).toBe('none');
    });

    it('isSameLeaveEntries は並び順に左右されない', () => {
        const a = [{ title: '有給(午前)' }, { title: '振休(午後)', substitute_for_date: '2026-11-08' }];
        expect(isSameLeaveEntries(a, [...a].reverse())).toBe(true);
        expect(isSameLeaveEntries(a, [{ title: '有給(午前)' }])).toBe(false);
    });
});

describe('getLeaveConflictWarnings', () => {
    const rec = (start_time, end_time, hours = 0) => ({ start_time, end_time, hours });

    it('終日の休みに作業実績があれば警告（時間数だけの実績も数える）', () => {
        expect(getLeaveConflictWarnings([{ title: '有給' }], [rec('08:00:00', '17:00:00')])).toHaveLength(1);
        expect(getLeaveConflictWarnings([{ title: '振休' }], [rec(null, null, 3)])).toHaveLength(1);
        expect(getLeaveConflictWarnings([{ title: '有給' }], [])).toEqual([]);
    });

    it('午前休は 12:00 より前、午後休は 13:00 より後の作業で警告', () => {
        expect(getLeaveConflictWarnings([{ title: '有給(午前)' }], [rec('13:00', '17:00')])).toEqual([]);
        expect(getLeaveConflictWarnings([{ title: '有給(午前)' }], [rec('11:00', '17:00')])).toHaveLength(1);
        expect(getLeaveConflictWarnings([{ title: '有給(午後)' }], [rec('08:00', '12:00')])).toEqual([]);
        expect(getLeaveConflictWarnings([{ title: '有給(午後)' }], [rec('08:00', '13:30')])).toHaveLength(1);
        // 時間数だけの実績は半日休では判定しない
        expect(getLeaveConflictWarnings([{ title: '有給(午後)' }], [rec(null, null, 4)])).toEqual([]);
    });

    it('日をまたぐ作業は午後にかかる', () => {
        expect(getLeaveConflictWarnings([{ title: '振休(午後)' }], [rec('22:00', '05:00')])).toHaveLength(1);
    });
});

describe('formatShortDateWithDow', () => {
    it('月/日(曜) にする', () => {
        expect(formatShortDateWithDow('2026-11-08')).toBe('11/8(日)');
        expect(formatShortDateWithDow('')).toBe('');
    });
});
