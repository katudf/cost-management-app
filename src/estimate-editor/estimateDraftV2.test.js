import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDraftAge, isDraftSameAsContent, saveEstimateDraft, loadEstimateDraft, clearEstimateDraft,
  moveDraftToPending, DRAFT_SLOT_PENDING,
} from './estimateDraftV2';
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

describe('isDraftSameAsContent', () => {
  const content = () => ({
    header: { title: '外壁塗装', status: 'draft', tax_rate: 0.1 },
    sheets: [{ id: 1, title: null }],
    items: [{ _uid: 'a', id: 10, name: '足場', amount: 1000 }],
  });

  it('行の識別子・キーの順番・ステータス項目・鑑に混ざったDBの列の違いは同じとみなす', () => {
    const draft = {
      header: { status: 'submitted', tax_rate: 0.1, title: '外壁塗装', id: 5, created_at: 'x' },
      sheets: [{ title: null, id: 1 }],
      items: [{ amount: 1000, name: '足場', id: 10, _uid: 'zzz', note: undefined }],
      savedAt: 1,
    };
    expect(isDraftSameAsContent(draft, content(), { ignoreHeaderFields: ['status'] })).toBe(true);
  });

  it('鑑・シート・明細のどれかが違えば違うとみなす', () => {
    const base = content();
    expect(isDraftSameAsContent({ ...base, header: { ...base.header, title: '屋根塗装' } }, content())).toBe(false);
    expect(isDraftSameAsContent({ ...base, sheets: [...base.sheets, { id: 2, title: '別紙' }] }, content())).toBe(false);
    expect(isDraftSameAsContent({ ...base, items: [{ ...base.items[0], amount: 1200 }] }, content())).toBe(false);
    expect(isDraftSameAsContent(null, content())).toBe(false);
  });
});

describe('未判断の前回分の置き場', () => {
  const store = new Map();
  const fakeStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const content = (title) => ({ header: { title }, sheets: [{ id: 1 }], items: [] });
  const pending = { slot: DRAFT_SLOT_PENDING };

  it('通常の退避を前回分へ移し、新しい退避で上書きされない', () => {
    vi.stubGlobal('localStorage', fakeStorage);
    store.clear();
    saveEstimateDraft(7, content('前回'));
    moveDraftToPending(7);
    expect(loadEstimateDraft(7)).toBeNull();
    saveEstimateDraft(7, content('今回'));
    expect(loadEstimateDraft(7, pending).header.title).toBe('前回');
    expect(loadEstimateDraft(7).header.title).toBe('今回');
    // 前回分があるときに移しても、前回分（未判断の古い方）は残す
    moveDraftToPending(7);
    expect(loadEstimateDraft(7, pending).header.title).toBe('前回');
    clearEstimateDraft(7, pending);
    expect(loadEstimateDraft(7, pending)).toBeNull();
    vi.unstubAllGlobals();
  });
});
