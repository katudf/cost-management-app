import { describe, it, expect } from 'vitest';
import { formatNinkuRatio, formatNinkuLabels, formatNinkuAsOfLabel, parseTargetNinkuInput, INVALID_NINKU_INPUT } from './ninkuDisplay';

describe('formatNinkuRatio', () => {
    it('消化が整数なら整数で、目標は入力した整数で表示する', () => {
        expect(formatNinkuRatio(100, 414)).toBe('100/414');
    });

    it('消化に端数があれば小数第1位まで表示する', () => {
        expect(formatNinkuRatio(12.5, 400)).toBe('12.5/400');
        expect(formatNinkuRatio(1 / 3 + 1, 400)).toBe('1.3/400');
    });

    it('丸めて整数になるときは小数を付けない', () => {
        expect(formatNinkuRatio(2.96, 400)).toBe('3/400');
    });

    it('目標未設定で消化があれば「－」を出す', () => {
        expect(formatNinkuRatio(12, null)).toBe('12/－');
        expect(formatNinkuRatio(12, undefined)).toBe('12/－');
    });

    it('目標も消化もなければ空文字', () => {
        expect(formatNinkuRatio(0, null)).toBe('');
        expect(formatNinkuRatio(null, undefined)).toBe('');
    });

    it('目標があって消化がなければ 0/目標（目標0も設定済みとして出す）', () => {
        expect(formatNinkuRatio(0, 400)).toBe('0/400');
        expect(formatNinkuRatio(0, 0)).toBe('0/0');
    });
});

describe('parseTargetNinkuInput', () => {
    it('空欄は未設定（null）', () => {
        expect(parseTargetNinkuInput('')).toBeNull();
        expect(parseTargetNinkuInput('  ')).toBeNull();
        expect(parseTargetNinkuInput(null)).toBeNull();
    });

    it('0以上の整数を受け付ける', () => {
        expect(parseTargetNinkuInput('0')).toBe(0);
        expect(parseTargetNinkuInput(' 414 ')).toBe(414);
    });

    it('負の数・小数・文字は不正（undefined）', () => {
        expect(parseTargetNinkuInput('-1')).toBeUndefined();
        expect(parseTargetNinkuInput('12.5')).toBeUndefined();
        expect(parseTargetNinkuInput('abc')).toBeUndefined();
        expect(parseTargetNinkuInput('99999999999')).toBeUndefined();
    });

    it('数値として読めない入力の印は空欄（未設定）ではなく不正として扱う', () => {
        expect(parseTargetNinkuInput(INVALID_NINKU_INPUT)).toBeUndefined();
    });
});

describe('formatNinkuLabels', () => {
    it('現場ごとの表示文字列を作る', () => {
        expect(formatNinkuLabels({
            1: { consumedNinku: 12.5, targetNinku: 400 },
            2: { consumedNinku: 3, targetNinku: null },
            3: { consumedNinku: 0, targetNinku: null }
        })).toEqual({ 1: '12.5/400', 2: '3/－', 3: '' });
        expect(formatNinkuLabels(null)).toEqual({});
    });
});

describe('formatNinkuAsOfLabel', () => {
    it('月/日に「時点」を付ける（先頭の0は付けない）', () => {
        expect(formatNinkuAsOfLabel('2026-11-09', '2026-11-10')).toBe('11/9時点');
        expect(formatNinkuAsOfLabel('2026-01-05')).toBe('1/5時点');
    });

    it('今日と年が違うときは年も付ける', () => {
        expect(formatNinkuAsOfLabel('2027-01-05', '2026-12-28')).toBe('2027/1/5時点');
        expect(formatNinkuAsOfLabel('2025-12-28', '2026-01-05')).toBe('2025/12/28時点');
    });

    it('日付として読めなければ空文字', () => {
        expect(formatNinkuAsOfLabel('')).toBe('');
        expect(formatNinkuAsOfLabel(null)).toBe('');
        expect(formatNinkuAsOfLabel('2026/11/09')).toBe('');
    });
});
