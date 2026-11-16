import { describe, it, expect } from 'vitest';
import { getReportDayOffLabel, getReportHalfDayLeaveLabel, getReportSubstituteNotes } from './reportDayOffUtils';

const DATE = '2026-09-24';

describe('getReportDayOffLabel', () => {
    it('作業実績がある日は休日・有給でも null（作業内容を優先）', () => {
        expect(getReportDayOffLabel(DATE, {
            hasRecords: true,
            leaveAssignments: [{ date: DATE, projectId: null, title: '有給' }],
            companyHolidays: [{ date: DATE, description: null }],
        })).toBeNull();
    });

    it('配置表の有給を返す', () => {
        expect(getReportDayOffLabel(DATE, {
            hasRecords: false,
            leaveAssignments: [{ date: DATE, projectId: null, title: '有給' }],
        })).toBe('有給');
    });

    it('有給は会社休日より優先する', () => {
        expect(getReportDayOffLabel(DATE, {
            hasRecords: false,
            leaveAssignments: [{ date: DATE, projectId: null, title: '有給' }],
            companyHolidays: [{ date: DATE, description: null }],
        })).toBe('有給');
    });

    it('現場割当やスケジュール種別外の title は無視する', () => {
        expect(getReportDayOffLabel(DATE, {
            hasRecords: false,
            leaveAssignments: [
                { date: DATE, projectId: 5, title: '有給' },
                { date: DATE, projectId: null, title: 'メモ' },
            ],
        })).toBeNull();
    });

    it('会社カレンダーの休日は「休日」、会社行事は行事名', () => {
        expect(getReportDayOffLabel(DATE, { hasRecords: false, companyHolidays: [{ date: DATE, description: null }] })).toBe('休日');
        expect(getReportDayOffLabel(DATE, { hasRecords: false, companyHolidays: [{ date: DATE, description: '休日' }] })).toBe('休日');
        expect(getReportDayOffLabel(DATE, { hasRecords: false, companyHolidays: [{ date: DATE, description: '社員旅行' }] })).toBe('社員旅行');
        expect(getReportDayOffLabel(DATE, { hasRecords: false, companyHolidays: [{ date: DATE, description: '安全大会' }] })).toBe('安全大会');
    });

    it('該当なしは null', () => {
        expect(getReportDayOffLabel(DATE, { hasRecords: false })).toBeNull();
        expect(getReportDayOffLabel(DATE, { hasRecords: false, companyHolidays: [{ date: '2026-09-25' }] })).toBeNull();
    });
});

describe('半日休の表示', () => {
    it('作業実績のない日は半日休を「・」でつないで返す', () => {
        expect(getReportDayOffLabel(DATE, {
            hasRecords: false,
            leaveAssignments: [
                { date: DATE, projectId: null, title: '有給(午前)' },
                { date: DATE, projectId: null, title: '振休(午後)' },
            ],
        })).toBe('有給(午前)・振休(午後)');
    });

    it('getReportHalfDayLeaveLabel は作業実績のある日の半日休だけを返す', () => {
        const leaveAssignments = [
            { date: DATE, projectId: null, title: '有給(午前)' },
            { date: DATE, projectId: null, title: '健診' },
            { date: '2026-09-25', projectId: null, title: '振休(午後)' },
        ];
        expect(getReportHalfDayLeaveLabel(DATE, { hasRecords: true, leaveAssignments })).toBe('有給(午前)');
        expect(getReportHalfDayLeaveLabel(DATE, { hasRecords: false, leaveAssignments })).toBeNull();
        expect(getReportHalfDayLeaveLabel(DATE, {
            hasRecords: true,
            leaveAssignments: [{ date: DATE, projectId: null, title: '有給' }],
        })).toBeNull();
    });
});

describe('getReportSubstituteNotes', () => {
    it('振休の振替元を返す（振替元のない振休・有給は出さない）', () => {
        expect(getReportSubstituteNotes(DATE, {
            leaveAssignments: [{ date: DATE, projectId: null, title: '振休', substitute_for_date: '2026-09-20' }],
        })).toEqual(['振替元 9/20(日)']);
        expect(getReportSubstituteNotes(DATE, {
            leaveAssignments: [
                { date: DATE, projectId: null, title: '振休', substitute_for_date: null },
                { date: DATE, projectId: null, title: '有給(午前)' },
            ],
        })).toEqual([]);
    });

    it('半日が 2 つなら午前・午後を添える。halfDayOnly は半日だけ', () => {
        const leaveAssignments = [
            { date: DATE, projectId: null, title: '振休(午前)', substitute_for_date: '2026-09-13' },
            { date: DATE, projectId: null, title: '振休(午後)', substitute_for_date: '2026-09-20' },
        ];
        expect(getReportSubstituteNotes(DATE, { leaveAssignments })).toEqual(['振替元(午前) 9/13(日)', '振替元(午後) 9/20(日)']);
        expect(getReportSubstituteNotes(DATE, {
            halfDayOnly: true,
            leaveAssignments: [{ date: DATE, projectId: null, title: '振休', substitute_for_date: '2026-09-20' }],
        })).toEqual([]);
    });
});
