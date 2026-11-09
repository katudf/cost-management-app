import { describe, it, expect } from 'vitest';
import { isResigned, todayInJapan } from './resignation';

describe('todayInJapan', () => {
    it('UTC の 15時以降は日本時間で翌日になる', () => {
        expect(todayInJapan(new Date('2026-11-07T14:59:00Z'))).toBe('2026-11-07');
        expect(todayInJapan(new Date('2026-11-07T15:00:00Z'))).toBe('2026-11-08');
    });
});

describe('isResigned', () => {
    const now = new Date('2026-11-07T03:00:00Z'); // 日本時間 2026-11-07 12:00

    it('退職日が無ければ在籍', () => {
        expect(isResigned(null, now)).toBe(false);
        expect(isResigned('', now)).toBe(false);
        expect(isResigned('  ', now)).toBe(false);
    });

    it('退職日が今日以前なら退職済み', () => {
        expect(isResigned('2026-11-07', now)).toBe(true);
        expect(isResigned('2026-10-01', now)).toBe(true);
    });

    it('退職日が先の日付ならまだ在籍', () => {
        expect(isResigned('2026-11-08', now)).toBe(false);
    });

    it('時刻付きの値も日付で比べる', () => {
        expect(isResigned('2026-11-07T00:00:00', now)).toBe(true);
    });
});
