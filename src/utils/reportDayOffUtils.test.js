import { describe, it, expect } from 'vitest';
import { getReportDayOffLabel } from './reportDayOffUtils';

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
    });

    it('該当なしは null', () => {
        expect(getReportDayOffLabel(DATE, { hasRecords: false })).toBeNull();
        expect(getReportDayOffLabel(DATE, { hasRecords: false, companyHolidays: [{ date: '2026-09-25' }] })).toBeNull();
    });
});
