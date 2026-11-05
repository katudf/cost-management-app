import { describe, it, expect } from 'vitest';
import { buildDayOvertimeLines } from './overtimeReportUtils';

const D = '2026-11-05';

describe('buildDayOvertimeLines', () => {
    it('時間外が無ければ何も出さない', () => {
        expect(buildDayOvertimeLines([{ project_id: 1, overtime_hours: 0 }], D, [])).toEqual({ lines: [], approverName: '' });
    });

    it('早出だけなら承認が無くても（未承認）を付けない', () => {
        const records = [{ project_id: 1, overtime_hours: 1, early_overtime_hours: 1 }];
        expect(buildDayOvertimeLines(records, D, [])).toEqual({ lines: ['早出 1.0H'], approverName: '' });
    });

    it('残業が未承認なら（未承認）を付ける', () => {
        const records = [{ project_id: 1, overtime_hours: 3, early_overtime_hours: 1 }];
        expect(buildDayOvertimeLines(records, D, []).lines).toEqual(['早出 1.0H', '残業 2.0H（未承認）']);
    });

    it('残業が承認済みなら承認者名を返す', () => {
        const records = [{ project_id: 1, overtime_hours: 2, early_overtime_hours: 0 }];
        const approvals = [{ project_id: 1, date: D, status: 'approved', approved_by: '山田' }];
        expect(buildDayOvertimeLines(records, D, approvals)).toEqual({ lines: ['残業 2.0H'], approverName: '山田' });
    });

    it('早出だけの現場は承認の判定に含めない', () => {
        const records = [
            { project_id: 1, overtime_hours: 1, early_overtime_hours: 1 },
            { project_id: 2, overtime_hours: 2, early_overtime_hours: 0 },
        ];
        const approvals = [{ project_id: 2, date: D, status: 'approved', approved_by: '佐藤' }];
        expect(buildDayOvertimeLines(records, D, approvals)).toEqual({ lines: ['早出 1.0H', '残業 2.0H'], approverName: '佐藤' });
    });

    it('残業がある現場の1つでも未承認なら（未承認）', () => {
        const records = [
            { project_id: 1, overtime_hours: 1 },
            { project_id: 2, overtime_hours: 1 },
        ];
        const approvals = [{ project_id: 1, date: D, status: 'approved', approved_by: '山田' }];
        expect(buildDayOvertimeLines(records, D, approvals).lines).toEqual(['残業 2.0H（未承認）']);
    });

    it('早出の列が無い古い行は、すべて残業として扱う', () => {
        const records = [{ project_id: 1, overtime_hours: 1.5 }];
        expect(buildDayOvertimeLines(records, D, []).lines).toEqual(['残業 1.5H（未承認）']);
    });
});
