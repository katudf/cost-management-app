import { describe, it, expect } from 'vitest';
import { isMissingRpcError, isMissingRelationError } from './supabaseErrors';

describe('supabaseErrors', () => {
    it('関数が無いときは PGRST202', () => {
        expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true);
        expect(isMissingRpcError({ code: '42501' })).toBe(false);
        expect(isMissingRpcError(null)).toBe(false);
    });
    it('テーブル・ビューが無いときは PGRST205 か 42P01', () => {
        expect(isMissingRelationError({ code: 'PGRST205' })).toBe(true);
        expect(isMissingRelationError({ code: '42P01' })).toBe(true);
        expect(isMissingRelationError({ code: 'PGRST202' })).toBe(false);
        expect(isMissingRelationError(undefined)).toBe(false);
    });
});
