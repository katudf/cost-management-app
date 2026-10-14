import { describe, it, expect } from 'vitest';
import { isActualHoliday, isFreeTextEvent, isNonWorkingDay, getHolidayStyle } from './holidayUtils';

describe('holidayUtils', () => {
    it('null / 休日 は休業日、会議・自由記入（旧 社員旅行 含む）は出勤日', () => {
        expect(isActualHoliday({ description: null })).toBe(true);
        expect(isActualHoliday({ description: '休日' })).toBe(true);
        expect(isActualHoliday({ description: '会議' })).toBe(false);
        expect(isActualHoliday({ description: '社員旅行' })).toBe(false);
        expect(isActualHoliday({ description: '安全大会' })).toBe(false);
        expect(isActualHoliday(null)).toBe(false);
    });

    it('自由記入の判定', () => {
        expect(isFreeTextEvent({ description: '安全大会' })).toBe(true);
        expect(isFreeTextEvent({ description: '会議' })).toBe(false);
        expect(isFreeTextEvent({ description: null })).toBe(false);
        expect(isFreeTextEvent(null)).toBe(false);
    });

    it('日曜は登録がなくても休業日', () => {
        expect(isNonWorkingDay(0, null)).toBe(true);
        expect(isNonWorkingDay(1, { description: '安全大会' })).toBe(false);
    });

    it('自由記入は先頭2文字をラベルに使う', () => {
        expect(getHolidayStyle({ description: '安全大会' }).shortLabel).toBe('安全');
        expect(getHolidayStyle({ description: '休日' }).shortLabel).toBe('休');
        expect(getHolidayStyle({ description: '会議' }).shortLabel).toBe('会議');
        expect(getHolidayStyle({ description: '社員旅行' }).shortLabel).toBe('社員');
        expect(getHolidayStyle(null)).toBeNull();
    });
});
