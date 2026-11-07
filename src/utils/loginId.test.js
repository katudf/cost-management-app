import { describe, it, expect } from 'vitest';
import {
    normalizeLoginId,
    isValidLoginId,
    loginIdToEmail,
    emailToLoginId,
    loginInputToEmail,
    canManageStaffLogin,
} from './loginId';
import { STAFF_ROLE } from './constants';

describe('normalizeLoginId', () => {
    it('前後の空白を除き、小文字にする', () => {
        expect(normalizeLoginId('  Kimura01 ')).toBe('kimura01');
    });

    it('null / undefined は空文字', () => {
        expect(normalizeLoginId(null)).toBe('');
        expect(normalizeLoginId(undefined)).toBe('');
    });
});

describe('isValidLoginId', () => {
    it('3〜20文字の英小文字・数字・_ - は使える', () => {
        expect(isValidLoginId('abc')).toBe(true);
        expect(isValidLoginId('a'.repeat(20))).toBe(true);
        expect(isValidLoginId('tanaka_01-b')).toBe(true);
    });

    it('大文字は小文字として扱う', () => {
        expect(isValidLoginId('KIMURA')).toBe(true);
    });

    it('2文字以下・21文字以上は使えない', () => {
        expect(isValidLoginId('ab')).toBe(false);
        expect(isValidLoginId('a'.repeat(21))).toBe(false);
        expect(isValidLoginId('')).toBe(false);
    });

    it('記号・空白・全角・@ は使えない', () => {
        expect(isValidLoginId('kimura.01')).toBe(false);
        expect(isValidLoginId('kim ura')).toBe(false);
        expect(isValidLoginId('きむら')).toBe(false);
        expect(isValidLoginId('ｋｉｍｕｒａ')).toBe(false);
        expect(isValidLoginId('a@b')).toBe(false);
    });
});

describe('loginIdToEmail / emailToLoginId', () => {
    it('IDを架空メールに変換する', () => {
        expect(loginIdToEmail(' Kimura01 ')).toBe('kimura01@login.invalid');
    });

    it('架空メールからIDを取り出す（大文字でも可）', () => {
        expect(emailToLoginId('kimura01@login.invalid')).toBe('kimura01');
        expect(emailToLoginId('KIMURA01@LOGIN.INVALID')).toBe('kimura01');
    });

    it('架空ドメインでなければ null', () => {
        expect(emailToLoginId('someone@example.com')).toBeNull();
        expect(emailToLoginId('x@login.invalid.example.com')).toBeNull();
        expect(emailToLoginId(null)).toBeNull();
    });
});

describe('loginInputToEmail', () => {
    it('@ を含まなければIDとして変換する', () => {
        expect(loginInputToEmail('Kimura01')).toBe('kimura01@login.invalid');
    });

    it('@ を含めば従来のメールアドレスとしてそのまま使う（移行期間）', () => {
        expect(loginInputToEmail(' someone@example.com ')).toBe('someone@example.com');
    });
});

describe('canManageStaffLogin', () => {
    const { ADMIN, SYSTEM_ADMIN, OFFICE, WORKER, VIEWER } = STAFF_ROLE;

    it('admin は office / worker / viewer を操作できる', () => {
        for (const target of [OFFICE, WORKER, VIEWER]) {
            expect(canManageStaffLogin(ADMIN, target)).toBe(true);
        }
    });

    it('admin は admin / system_admin を操作できない', () => {
        expect(canManageStaffLogin(ADMIN, ADMIN)).toBe(false);
        expect(canManageStaffLogin(ADMIN, SYSTEM_ADMIN)).toBe(false);
    });

    it('system_admin はすべて操作できる', () => {
        for (const target of [ADMIN, SYSTEM_ADMIN, OFFICE, WORKER, VIEWER]) {
            expect(canManageStaffLogin(SYSTEM_ADMIN, target)).toBe(true);
        }
    });

    it('管理者以外は操作できない', () => {
        expect(canManageStaffLogin(OFFICE, WORKER)).toBe(false);
        expect(canManageStaffLogin(undefined, WORKER)).toBe(false);
    });
});
