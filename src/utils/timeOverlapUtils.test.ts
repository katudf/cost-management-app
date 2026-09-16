import { describe, it, expect } from 'vitest';
import {
    toMinutes,
    formatMinutes,
    buildOtherProjectIntervals,
    buildCurrentProjectIntervals,
    findOverlaps,
    calculateTimeOverlapWarnings,
} from './timeOverlapUtils';

// WorkerApp.jsx の useMemo に約75行べた書きされていた重複検出ロジック。
// 日跨ぎ・自己比較の除外・重複警告の畳み込みが未テストだったので、ここで固定する。

const task = (id: number, name: string, slots: Array<{
    slot_id: number;
    start_time?: string | null;
    end_time?: string | null;
    is_overnight?: boolean;
}>) => ({ id, name, time_slots: slots });

const PROJECTS = [
    { id: 1, name: 'A現場' },
    { id: 2, name: 'B現場' },
];

describe('toMinutes', () => {
    it('HH:MM を 0:00 からの分数にする', () => {
        expect(toMinutes('00:00')).toBe(0);
        expect(toMinutes('09:30')).toBe(570);
        expect(toMinutes('23:59')).toBe(1439);
    });

    it('未入力（null / undefined / 空文字）は null', () => {
        expect(toMinutes(null)).toBeNull();
        expect(toMinutes(undefined)).toBeNull();
        expect(toMinutes('')).toBeNull();
    });

    it('時刻として解釈できない文字列は null（NaN を伝播させない）', () => {
        expect(toMinutes('あとで')).toBeNull();
        expect(toMinutes('9')).toBeNull();
    });
});

describe('formatMinutes', () => {
    it('分数を H:MM にする', () => {
        expect(formatMinutes(570)).toBe('9:30');
        expect(formatMinutes(600)).toBe('10:00');
    });

    it('日跨ぎ（24時間超）はそのまま 25:30 のように出す', () => {
        expect(formatMinutes(1530)).toBe('25:30');
    });
});

describe('buildOtherProjectIntervals', () => {
    it('選択中の現場のレコードは除外する（自分自身と重複しない）', () => {
        const records = [
            { project_id: 1, start_time: '08:00', end_time: '17:00' },
            { project_id: 2, start_time: '08:00', end_time: '17:00' },
        ];
        const intervals = buildOtherProjectIntervals(records, 1, PROJECTS);
        expect(intervals).toHaveLength(1);
        expect(intervals[0].projectName).toBe('B現場');
    });

    it('project_id が文字列でも数値と同じものとして扱う', () => {
        const records = [{ project_id: '1', start_time: '08:00', end_time: '17:00' }];
        expect(buildOtherProjectIntervals(records, 1, PROJECTS)).toHaveLength(0);
    });

    it('プロジェクトマスタに無い現場は「別現場」と表示する', () => {
        const records = [{ project_id: 99, start_time: '08:00', end_time: '17:00' }];
        expect(buildOtherProjectIntervals(records, 1, PROJECTS)[0].projectName).toBe('別現場');
    });

    it('時刻が未入力のレコードは無視する', () => {
        const records = [
            { project_id: 2, start_time: null, end_time: '17:00' },
            { project_id: 2, start_time: '08:00', end_time: '' },
        ];
        expect(buildOtherProjectIntervals(records, 1, PROJECTS)).toHaveLength(0);
    });
});

describe('buildCurrentProjectIntervals', () => {
    it('通常の時間帯をそのまま時間帯にする', () => {
        const { intervals, warnings } = buildCurrentProjectIntervals(
            [task(10, '内装', [{ slot_id: 100, start_time: '08:00', end_time: '17:00' }])],
            1,
            'A現場'
        );
        expect(warnings).toHaveLength(0);
        expect(intervals).toEqual([{
            projectId: 1,
            projectName: 'A現場',
            taskName: '内装',
            start: 480,
            end: 1020,
            slotId: 100,
        }]);
    });

    it('翌日チェックありなら終了時刻に24時間を足す', () => {
        const { intervals, warnings } = buildCurrentProjectIntervals(
            [task(10, '夜間工事', [{ slot_id: 100, start_time: '22:00', end_time: '05:00', is_overnight: true }])],
            1,
            'A現場'
        );
        expect(warnings).toHaveLength(0);
        // 22:00 = 1320, 翌05:00 = 300 + 1440 = 1740
        expect(intervals[0].start).toBe(1320);
        expect(intervals[0].end).toBe(1740);
    });

    it('翌日チェック忘れ（終了が開始以前）は時間帯にせず警告にする', () => {
        const { intervals, warnings } = buildCurrentProjectIntervals(
            [task(10, '夜間工事', [{ slot_id: 100, start_time: '22:00', end_time: '05:00' }])],
            1,
            'A現場'
        );
        expect(intervals).toHaveLength(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].key).toBe('inverted-10-100');
        expect(warnings[0].message).toContain('「夜間工事」');
        expect(warnings[0].message).toContain('「翌日」にチェック');
    });

    it('開始と終了が同じ時刻（長さ0）も警告にする', () => {
        const { warnings } = buildCurrentProjectIntervals(
            [task(10, '打合せ', [{ slot_id: 100, start_time: '09:00', end_time: '09:00' }])],
            1,
            'A現場'
        );
        expect(warnings).toHaveLength(1);
    });

    it('時刻が片方でも未入力なら無視する（入力途中で警告を出さない）', () => {
        const { intervals, warnings } = buildCurrentProjectIntervals(
            [task(10, '内装', [{ slot_id: 100, start_time: '08:00', end_time: null }])],
            1,
            'A現場'
        );
        expect(intervals).toHaveLength(0);
        expect(warnings).toHaveLength(0);
    });
});

describe('findOverlaps', () => {
    const interval = (over: Partial<Parameters<typeof findOverlaps>[0][0]>) => ({
        projectId: 1,
        projectName: 'A現場',
        taskName: '作業',
        start: 480,
        end: 1020,
        ...over,
    });

    it('重なりが無ければ警告なし', () => {
        expect(findOverlaps([
            interval({ taskName: '午前', slotId: 1, start: 480, end: 720 }),
            interval({ taskName: '午後', slotId: 2, start: 780, end: 1020 }),
        ])).toHaveLength(0);
    });

    it('端が接するだけ（9:00終了と9:00開始）は重複としない', () => {
        expect(findOverlaps([
            interval({ taskName: '午前', slotId: 1, start: 480, end: 540 }),
            interval({ taskName: '午後', slotId: 2, start: 540, end: 600 }),
        ])).toHaveLength(0);
    });

    it('同じ現場内の重複は作業項目名で表示する', () => {
        const [w] = findOverlaps([
            interval({ taskName: '内装', slotId: 1, start: 480, end: 720 }),
            interval({ taskName: '外装', slotId: 2, start: 600, end: 900 }),
        ]);
        expect(w.message).toBe('「内装」と「外装」の作業時間が 10:00〜12:00 で重複しています');
    });

    it('別の現場との重複は現場名で表示する', () => {
        const [w] = findOverlaps([
            interval({ projectId: 2, projectName: 'B現場', taskName: 'B現場', start: 480, end: 720 }),
            interval({ projectId: 1, projectName: 'A現場', taskName: '内装', slotId: 1, start: 600, end: 900 }),
        ]);
        expect(w.message).toBe('「B現場」と「A現場」の作業時間が 10:00〜12:00 で重複しています');
    });

    it('同一スロット同士は比較しない（自分自身との重複を出さない）', () => {
        expect(findOverlaps([
            interval({ taskName: '内装', slotId: 7, start: 480, end: 720 }),
            interval({ taskName: '内装', slotId: 7, start: 480, end: 720 }),
        ])).toHaveLength(0);
    });

    it('スロットidを持たない他現場レコード同士は比較される', () => {
        expect(findOverlaps([
            interval({ projectId: 2, projectName: 'B現場', taskName: 'B現場', start: 480, end: 720 }),
            interval({ projectId: 3, projectName: 'C現場', taskName: 'C現場', start: 600, end: 900 }),
        ])).toHaveLength(1);
    });

    it('同じ組み合わせの警告は1件に畳む', () => {
        // 現場名・開始時刻が同じレコードが2件あっても警告は1件
        const dup = {
            projectId: 2, projectName: 'B現場', taskName: 'B現場', start: 600, end: 900,
        };
        const warnings = findOverlaps([
            interval({ taskName: '内装', slotId: 1, start: 480, end: 720 }),
            interval(dup),
            interval(dup),
        ]);
        const keys = warnings.map(w => w.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('日跨ぎの時間帯が翌日側で重なることを検出する', () => {
        // 22:00〜翌5:00 と 翌3:00〜翌8:00（どちらも +1440 済み）
        const [w] = findOverlaps([
            interval({ taskName: '夜勤', slotId: 1, start: 1320, end: 1740 }),
            interval({ taskName: '早朝', slotId: 2, start: 1620, end: 1920 }),
        ]);
        expect(w.message).toContain('27:00〜29:00');
    });
});

describe('calculateTimeOverlapWarnings', () => {
    it('現場が未選択なら何も警告しない', () => {
        expect(calculateTimeOverlapWarnings({
            tasks: [task(10, '内装', [{ slot_id: 1, start_time: '08:00', end_time: '17:00' }])],
            dailyRecords: [],
            projects: PROJECTS,
            selectedProjectId: null,
        })).toEqual([]);
    });

    it('他現場と時間が重なれば警告する（二重計上の検出）', () => {
        const warnings = calculateTimeOverlapWarnings({
            tasks: [task(10, '内装', [{ slot_id: 1, start_time: '08:00', end_time: '17:00' }])],
            dailyRecords: [{ project_id: 2, start_time: '13:00', end_time: '18:00' }],
            projects: PROJECTS,
            selectedProjectId: 1,
        });
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toBe('「B現場」と「A現場」の作業時間が 13:00〜17:00 で重複しています');
    });

    it('同じ現場の作業項目同士の重複も警告する', () => {
        const warnings = calculateTimeOverlapWarnings({
            tasks: [
                task(10, '内装', [{ slot_id: 1, start_time: '08:00', end_time: '12:00' }]),
                task(11, '外装', [{ slot_id: 2, start_time: '10:00', end_time: '15:00' }]),
            ],
            dailyRecords: [],
            projects: PROJECTS,
            selectedProjectId: 1,
        });
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toBe('「内装」と「外装」の作業時間が 10:00〜12:00 で重複しています');
    });

    it('重ならない入力では警告が出ない', () => {
        expect(calculateTimeOverlapWarnings({
            tasks: [task(10, '内装', [{ slot_id: 1, start_time: '08:00', end_time: '12:00' }])],
            dailyRecords: [{ project_id: 2, start_time: '13:00', end_time: '17:00' }],
            projects: PROJECTS,
            selectedProjectId: 1,
        })).toEqual([]);
    });

    it('翌日チェックがあれば深夜作業は重複扱いにならない', () => {
        expect(calculateTimeOverlapWarnings({
            tasks: [
                task(10, '日中', [{ slot_id: 1, start_time: '08:00', end_time: '17:00' }]),
                task(11, '夜間', [{ slot_id: 2, start_time: '22:00', end_time: '05:00', is_overnight: true }]),
            ],
            dailyRecords: [],
            projects: PROJECTS,
            selectedProjectId: 1,
        })).toEqual([]);
    });

    it('時刻逆転の警告は重複警告より先に並ぶ', () => {
        const warnings = calculateTimeOverlapWarnings({
            tasks: [
                task(10, '夜間', [{ slot_id: 1, start_time: '22:00', end_time: '05:00' }]),
                task(11, '内装', [{ slot_id: 2, start_time: '08:00', end_time: '12:00' }]),
            ],
            dailyRecords: [{ project_id: 2, start_time: '10:00', end_time: '15:00' }],
            projects: PROJECTS,
            selectedProjectId: 1,
        });
        expect(warnings).toHaveLength(2);
        expect(warnings[0].key).toBe('inverted-10-1');
        expect(warnings[1].key).toContain('overlap-');
    });

    it('選択中の現場idが文字列でも数値と同じに扱う', () => {
        const warnings = calculateTimeOverlapWarnings({
            tasks: [task(10, '内装', [{ slot_id: 1, start_time: '08:00', end_time: '17:00' }])],
            dailyRecords: [{ project_id: 1, start_time: '13:00', end_time: '18:00' }],
            projects: PROJECTS,
            selectedProjectId: '1',
        });
        // 同じ現場のレコードなので他現場としては取り込まれない
        expect(warnings).toEqual([]);
    });

    it('警告の key は React の list key として一意になる', () => {
        const warnings = calculateTimeOverlapWarnings({
            tasks: [
                task(10, '内装', [{ slot_id: 1, start_time: '08:00', end_time: '12:00' }]),
                task(11, '外装', [{ slot_id: 2, start_time: '10:00', end_time: '15:00' }]),
                task(12, '電気', [{ slot_id: 3, start_time: '11:00', end_time: '16:00' }]),
            ],
            dailyRecords: [{ project_id: 2, start_time: '09:00', end_time: '18:00' }],
            projects: PROJECTS,
            selectedProjectId: 1,
        });
        const keys = warnings.map(w => w.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(warnings.length).toBeGreaterThan(1);
    });
});
