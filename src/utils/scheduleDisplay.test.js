import { describe, it, expect } from 'vitest';
import {
    isBarProject, buildBarIndexMap, projectColor, buildAssignmentLookup, NON_BAR_PROJECT_COLOR,
} from './scheduleDisplay';
import { DEFAULT_COLORS, PROJECT_STATUS } from './constants';

const p = (id, extra = {}) => ({ id, name: `現場${id}`, status: PROJECT_STATUS.IN_PROGRESS, display_order: null, created_at: `2026-01-0${id}`, ...extra });

describe('isBarProject', () => {
    it('予定・施工中で有給用でない案件だけ', () => {
        expect(isBarProject(p(1))).toBe(true);
        expect(isBarProject(p(1, { status: PROJECT_STATUS.SCHEDULED }))).toBe(true);
        expect(isBarProject(p(1, { status: PROJECT_STATUS.COMPLETED }))).toBe(false);
        expect(isBarProject(p(1, { name: '有給' }))).toBe(false);
    });
});

describe('buildBarIndexMap', () => {
    it('表示順（未設定は後ろ）→ 作成日時の順で、バー対象だけに位置を振る', () => {
        const map = buildBarIndexMap([
            p(1),
            p(2, { display_order: 5 }),
            p(3, { status: PROJECT_STATUS.COMPLETED }),
            p(4, { display_order: 1 }),
        ]);
        expect(map.get(4)).toBe(0);
        expect(map.get(2)).toBe(1);
        expect(map.get(1)).toBe(2);
        expect(map.has(3)).toBe(false);
    });
});

describe('projectColor', () => {
    it('個別色 → 並び位置の既定色 → 灰色の順', () => {
        expect(projectColor({ bar_color: '#123456' }, 0)).toBe('#123456');
        expect(projectColor({}, 1)).toBe(DEFAULT_COLORS[1]);
        expect(projectColor({}, DEFAULT_COLORS.length)).toBe(DEFAULT_COLORS[0]);
        expect(projectColor({}, undefined)).toBe(NON_BAR_PROJECT_COLOR);
    });
});

describe('buildAssignmentLookup', () => {
    it('作業員×日付で束ね、並び順の未設定を先頭にする', () => {
        const lookup = buildAssignmentLookup([
            { id: 1, workerId: 7, date: '2026-11-05', assignment_order: 2 },
            { id: 2, workerId: 7, date: '2026-11-05', assignment_order: null },
            { id: 3, workerId: 7, date: '2026-11-05', assignment_order: 1 },
        ]);
        expect(lookup['7_2026-11-05'].map(a => a.id)).toEqual([2, 3, 1]);
    });
});
