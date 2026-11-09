import { describe, it, expect } from 'vitest';
import { canUseAdminApp, getSessionKind, SESSION_KIND, STAFF_ROLE } from './constants';

describe('canUseAdminApp', () => {
    it('admin / system_admin / office は管理者画面に入れる', () => {
        expect(canUseAdminApp(STAFF_ROLE.ADMIN)).toBe(true);
        expect(canUseAdminApp(STAFF_ROLE.SYSTEM_ADMIN)).toBe(true);
        expect(canUseAdminApp(STAFF_ROLE.OFFICE)).toBe(true);
    });

    it('worker / viewer / 担当者情報なしは入れない', () => {
        expect(canUseAdminApp(STAFF_ROLE.WORKER)).toBe(false);
        expect(canUseAdminApp(STAFF_ROLE.VIEWER)).toBe(false);
        expect(canUseAdminApp(undefined)).toBe(false);
        expect(canUseAdminApp(null)).toBe(false);
    });
});

describe('getSessionKind', () => {
    const worker = { id: 1, name: '菊池　春樹' };

    it('担当者（事務以上）は STAFF。担当者兼作業員も STAFF', () => {
        expect(getSessionKind({ role: STAFF_ROLE.ADMIN }, null)).toBe(SESSION_KIND.STAFF);
        expect(getSessionKind({ role: STAFF_ROLE.OFFICE }, worker)).toBe(SESSION_KIND.STAFF);
    });

    it('作業員の個人アカウントは PERSONAL_WORKER', () => {
        expect(getSessionKind(null, worker)).toBe(SESSION_KIND.PERSONAL_WORKER);
    });

    it('廃止した作業員の共通ID（role が worker）と閲覧用は使えない（OTHER）', () => {
        expect(getSessionKind({ role: STAFF_ROLE.WORKER }, null)).toBe(SESSION_KIND.OTHER);
        expect(getSessionKind({ role: STAFF_ROLE.VIEWER }, null)).toBe(SESSION_KIND.OTHER);
        expect(getSessionKind(null, null)).toBe(SESSION_KIND.OTHER);
    });

    it('初めてのオフライン起動で誰か分からないときは UNKNOWN', () => {
        expect(getSessionKind(null, null, true)).toBe(SESSION_KIND.UNKNOWN);
    });

    it('共通IDの区分は無い', () => {
        expect(SESSION_KIND.SHARED_WORKER).toBeUndefined();
    });
});
