import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDraftAge } from './estimateDraftV2';
afterEach(() => vi.useRealTimers());

describe('draft timestamp display', () => {
  it('uses the same relative age for epoch, ISO and Date timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
    const date = new Date('2026-10-01T02:55:00Z');
    expect(formatDraftAge(date.getTime())).toBe('5分前');
    expect(formatDraftAge(date.toISOString())).toBe('5分前');
    expect(formatDraftAge(date)).toBe('5分前');
  });
  it.each([undefined, null, NaN, Infinity, '', 'not a date', new Date('invalid')])('suppresses invalid timestamp %s', value => {
    expect(formatDraftAge(value)).toBe('');
  });
});
