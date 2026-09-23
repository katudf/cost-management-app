import { describe, it, expect } from 'vitest';
import { buildCopiedAssignments } from './useAssignmentState';

// handleActionCopy/handleActionCutで「targetWorkerIds×targetDatesの範囲を
// assignmentLookupから集めてdayOffset/workerOffsetを付与する」処理が
// 完全に同一のロジックとして2箇所にべた書きされていたための一本化（§9.19）。

describe('buildCopiedAssignments', () => {
  it('単一workerId・単一日付の既存配置からcopiedDataを1件作る', () => {
    const assignmentLookup = {
      'w1_2026-09-01': [{ id: 'a1', projectId: 'p1', title: 'foo', assignment_order: 0 }]
    };
    const { copiedData, sourceRecords } = buildCopiedAssignments(['w1'], ['2026-09-01'], assignmentLookup);

    expect(copiedData).toEqual([
      { dayOffset: 0, workerOffset: 0, projectId: 'p1', title: 'foo', assignment_order: 0 }
    ]);
    expect(sourceRecords).toEqual([{ id: 'a1', projectId: 'p1', title: 'foo', assignment_order: 0 }]);
  });

  it('複数日付の場合、baseDateからの日数差をdayOffsetとして付与する', () => {
    const assignmentLookup = {
      'w1_2026-09-01': [{ id: 'a1', projectId: 'p1', title: 'day0', assignment_order: 0 }],
      'w1_2026-09-03': [{ id: 'a2', projectId: 'p1', title: 'day2', assignment_order: 1 }]
    };
    const { copiedData } = buildCopiedAssignments(['w1'], ['2026-09-01', '2026-09-03'], assignmentLookup);

    expect(copiedData).toEqual([
      { dayOffset: 0, workerOffset: 0, projectId: 'p1', title: 'day0', assignment_order: 0 },
      { dayOffset: 2, workerOffset: 0, projectId: 'p1', title: 'day2', assignment_order: 1 }
    ]);
  });

  it('複数workerIdの場合、出現順にworkerOffsetを付与する', () => {
    const assignmentLookup = {
      'w1_2026-09-01': [{ id: 'a1', projectId: 'p1', title: 'w1', assignment_order: 0 }],
      'w2_2026-09-01': [{ id: 'a2', projectId: 'p2', title: 'w2', assignment_order: 0 }]
    };
    const { copiedData } = buildCopiedAssignments(['w1', 'w2'], ['2026-09-01'], assignmentLookup);

    expect(copiedData.map(d => d.workerOffset)).toEqual([0, 1]);
  });

  it('assignmentLookupに存在しないセルは無視する（0件）', () => {
    const { copiedData, sourceRecords } = buildCopiedAssignments(['w1'], ['2026-09-01'], {});
    expect(copiedData).toEqual([]);
    expect(sourceRecords).toEqual([]);
  });

  it('同一セルに複数配置がある場合は全件をcopiedDataに含める', () => {
    const assignmentLookup = {
      'w1_2026-09-01': [
        { id: 'a1', projectId: 'p1', title: 'first', assignment_order: 0 },
        { id: 'a2', projectId: 'p2', title: 'second', assignment_order: 1 }
      ]
    };
    const { copiedData, sourceRecords } = buildCopiedAssignments(['w1'], ['2026-09-01'], assignmentLookup);

    expect(copiedData).toHaveLength(2);
    expect(sourceRecords).toHaveLength(2);
    expect(sourceRecords[0].id).toBe('a1');
    expect(sourceRecords[1].id).toBe('a2');
  });
});
