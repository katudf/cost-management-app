import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { buildCellCommentLookup } from '../useAssignmentCellComments';

describe('buildCellCommentLookup', () => {
    it('案件ID→日付→コメントのルックアップを作る', () => {
        const lookup = buildCellCommentLookup([
            { project_id: 1, date: '2026-10-01', comment: 'A' },
            { project_id: 1, date: '2026-10-02', comment: 'B' },
            { project_id: 2, date: '2026-10-01', comment: 'C' }
        ]);
        expect(lookup).toEqual({
            1: { '2026-10-01': 'A', '2026-10-02': 'B' },
            2: { '2026-10-01': 'C' }
        });
    });

    it('空配列なら空オブジェクト', () => {
        expect(buildCellCommentLookup([])).toEqual({});
    });
});
