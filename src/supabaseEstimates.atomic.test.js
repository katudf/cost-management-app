import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, from, single } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), single: vi.fn() }));
vi.mock('./lib/supabase', () => ({ supabase: { rpc, from } }));
import { saveEstimateV3, approveEstimate, returnEstimate, buildSaveItemsPayload } from './supabaseEstimates';

beforeEach(() => {
  vi.resetAllMocks();
  from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
});

describe('atomic estimate save transport', () => {
  it('submits a new header, sheets and latest items in one RPC with a null ID', async () => {
    const result = { id: 42, sheet_ids: ['sheet'], status: 'pending' };
    rpc.mockResolvedValue({ data: result, error: null });
    const header = { title: 'Edited title', payment_terms: '', total_with_tax: 110 };
    const sheets = [{ id: null, title: null }];
    const items = [{ sheet_index: 0, item_type: 'item', amount: 100 }];
    expect(await saveEstimateV3(null, header, sheets, items, 2)).toEqual(result);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('save_estimate_v3', {
      p_estimate_id: null, p_header: header, p_sheets: sheets, p_items: items,
      p_submit: true, p_approver_staff_id: 2,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('updates an existing draft without requesting a status transition', async () => {
    rpc.mockResolvedValue({ data: { id: 42, sheet_ids: [], status: 'draft' } });
    await saveEstimateV3(42, {}, [], []);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_estimate_id: 42, p_submit: false, p_approver_staff_id: null });
  });

  it.each(['23505', 'P0001', '42501'])('preserves database error %s for UI notification and retry', async code => {
    const error = { code, message: 'Injected failure' };
    rpc.mockResolvedValue({ error });
    await expect(saveEstimateV3(42, {}, [], [], 2)).rejects.toBe(error);
    expect(from).not.toHaveBeenCalled();
  });

  it('maps temporary sheets and category links without losing empty rows', () => {
    const payload = buildSaveItemsPayload([{ id: 'temp-top' }, { id: 'temp-sub' }], [
      { sheet_id: 'temp-top', item_type: 'item', name: 'Link', linked_category_item_id: 'cat-temp' },
      { sheet_id: 'temp-sub', item_type: 'category', _uid: 'cat-temp', name: 'Category' },
      { sheet_id: 'temp-sub', item_type: 'item', name: '', amount: '' },
    ]);
    expect(payload.payloadSheets.map(s => s.id)).toEqual([null, null]);
    expect(payload.payloadItems[0]).toMatchObject({ sheet_index: 0, linked_item_index: 1 });
    expect(payload.payloadItems[2]).toMatchObject({ sheet_index: 1, name: '', amount: null });
  });
});

describe('approval database evidence', () => {
  it.each(['approve', 'return'])('re-fetches the DB trail after %s', async action => {
    const trail = { status: action === 'approve' ? 'approved' : 'returned', approved_at: '2026-10-01T02:00:00Z', approved_by: 'Approver' };
    rpc.mockResolvedValue({ error: null });
    single.mockResolvedValue({ data: trail, error: null });
    expect(await (action === 'approve' ? approveEstimate(42) : returnEstimate(42, 'Reason'))).toEqual(trail);
    expect(from).toHaveBeenCalledExactlyOnceWith('estimates');
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(from.mock.invocationCallOrder[0]);
  });

  it('does not synthesize evidence after a rejected approval', async () => {
    const error = { message: 'Wrong approver' };
    rpc.mockResolvedValue({ error });
    await expect(approveEstimate(42)).rejects.toBe(error);
    expect(from).not.toHaveBeenCalled();
  });
});
