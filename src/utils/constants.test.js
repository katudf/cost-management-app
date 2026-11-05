import { describe, it, expect } from 'vitest';
import { canUseAdminApp, STAFF_ROLE } from './constants';

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
