/**
 * 作業時間帯の重複（ラップ）検出ロジック。
 *
 * 日報入力では、同じ作業員が同じ日に
 *   - 同じ現場の複数の作業項目
 *   - 別の現場（別プロジェクト）の日報
 * に時間を入力できてしまう。二重計上を防ぐため、時間帯が重なっていたら警告を出す。
 *
 * もともと `WorkerApp.jsx` の useMemo に約75行べた書きされていて、
 * 日跨ぎ・自己比較の除外・重複警告の畳み込みといった間違えやすい条件が
 * まったくテストされていなかったため、純粋関数として切り出した。
 */

import { toMinutes } from './workTimeUtils';

// 時刻→分の変換は workTimeUtils が持ち主。ここでは再輸出だけする
// （既存の import 元を壊さないため）。
export { toMinutes };

/**
 * 分数を 'H:MM' 形式にする（警告文の表示用）。
 * 24時間を超える値（日跨ぎ）はそのまま 25:30 のように表示する。
 */
export const formatMinutes = (minutes: number): string =>
    `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** 1日の分数。日跨ぎ（翌日）の終了時刻に加算する。 */
const MINUTES_PER_DAY = 1440;

/** 重複判定にかける時間帯。 */
export interface TimeInterval {
    /** 所属プロジェクトid。同一プロジェクトかどうかで警告文の表記が変わる */
    projectId: string | number;
    /** 別現場として表示するときの名前 */
    projectName: string;
    /** 同一現場内で表示するときの名前（作業項目名） */
    taskName: string;
    /** 開始（分） */
    start: number;
    /** 終了（分）。日跨ぎなら 1440 加算済み */
    end: number;
    /** 同一スロット同士を比較しないための識別子。他現場の記録には無い */
    slotId?: string | number;
}

/** 画面に出す警告1件。key は React の list key 兼、重複排除のキー。 */
export interface OverlapWarning {
    key: string;
    message: string;
}

/** 入力中の作業項目（WorkerApp の tasks の形） */
export interface TaskLike {
    id: string | number;
    name: string;
    time_slots: Array<{
        slot_id: string | number;
        start_time?: string | null;
        end_time?: string | null;
        is_overnight?: boolean;
    }>;
}

/** 他現場の日報レコード（workerDailyAllRecords の形） */
export interface DailyRecordLike {
    project_id: string | number;
    start_time?: string | null;
    end_time?: string | null;
}

/** プロジェクトの最小形 */
export interface ProjectLike {
    id: number;
    name?: string | null;
}

/**
 * 他現場（選択中でないプロジェクト）の日報を時間帯に変換する。
 *
 * 既知の制約: 他現場のレコードには日跨ぎフラグ（is_overnight）が無い。
 * そのため 22:00〜翌06:00 のような他現場の夜勤は start > end のまま時間帯になり、
 * `findOverlaps` の `a.start < b.end && b.start < a.end` がどちらも偽になって
 * 重複が検出されない（誤検知ではなく見落とし側に倒れる）。
 * 元の実装もこの制約を持っていたので、切り出しでは挙動を変えずそのまま残した。
 */
export const buildOtherProjectIntervals = (
    dailyRecords: DailyRecordLike[],
    selectedProjectId: string | number,
    projects: ProjectLike[]
): TimeInterval[] => {
    const intervals: TimeInterval[] = [];
    (dailyRecords || [])
        .filter(r => String(r.project_id) !== String(selectedProjectId))
        .forEach(r => {
            const start = toMinutes(r.start_time);
            const end = toMinutes(r.end_time);
            if (start === null || end === null) return;
            const proj = (projects || []).find(p => p.id === Number(r.project_id));
            const label = proj?.name || '別現場';
            intervals.push({
                projectId: r.project_id,
                projectName: label,
                taskName: label,
                start,
                end,
            });
        });
    return intervals;
};

/**
 * 入力中の作業項目を時間帯に変換する。
 * 開始 >= 終了（日跨ぎチェック忘れ）は時間帯にせず、警告として返す。
 */
export const buildCurrentProjectIntervals = (
    tasks: TaskLike[],
    selectedProjectId: string | number,
    currentProjectName: string
): { intervals: TimeInterval[]; warnings: OverlapWarning[] } => {
    const intervals: TimeInterval[] = [];
    const warnings: OverlapWarning[] = [];

    (tasks || []).forEach(t => {
        (t.time_slots || []).forEach(slot => {
            const start = toMinutes(slot.start_time);
            let end = toMinutes(slot.end_time);
            if (start === null || end === null) return;

            if (slot.is_overnight) end += MINUTES_PER_DAY;

            if (start >= end) {
                warnings.push({
                    key: `inverted-${t.id}-${slot.slot_id}`,
                    message: `「${t.name}」の終了時刻が開始時刻以前になっています。日跨ぎの場合は「翌日」にチェックを入れてください。`,
                });
                return;
            }

            intervals.push({
                projectId: selectedProjectId,
                projectName: currentProjectName,
                taskName: t.name,
                start,
                end,
                slotId: slot.slot_id,
            });
        });
    });

    return { intervals, warnings };
};

/**
 * 時間帯の総当たり比較で重複を検出する。
 *
 * - 同一スロット同士は比較しない（自分自身との重複は意味がない）
 * - 同一プロジェクト内なら作業項目名、別プロジェクトなら現場名で表示する
 * - 同じ組み合わせの警告は key で1件に畳む
 */
export const findOverlaps = (intervals: TimeInterval[]): OverlapWarning[] => {
    const warnings: OverlapWarning[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < intervals.length; i++) {
        for (let j = i + 1; j < intervals.length; j++) {
            const a = intervals[i];
            const b = intervals[j];

            if (a.slotId != null && b.slotId != null && a.slotId === b.slotId) continue;

            // 端が接するだけ（9:00終了 と 9:00開始）は重複としない
            if (!(a.start < b.end && b.start < a.end)) continue;

            const overlapStart = Math.max(a.start, b.start);
            const overlapEnd = Math.min(a.end, b.end);

            const isSameProject = String(a.projectId) === String(b.projectId);
            const nameA = isSameProject ? a.taskName : a.projectName;
            const nameB = isSameProject ? b.taskName : b.projectName;

            const key = `overlap-${a.projectId}-${a.taskName}-${a.start}-${b.projectId}-${b.taskName}-${b.start}`;
            if (seen.has(key)) continue;
            seen.add(key);

            warnings.push({
                key,
                message: `「${nameA}」と「${nameB}」の作業時間が ${formatMinutes(overlapStart)}〜${formatMinutes(overlapEnd)} で重複しています`,
            });
        }
    }

    return warnings;
};

/**
 * 日報入力画面の時間帯警告をすべて求める。
 * 現場未選択なら何も警告しない。
 */
export const calculateTimeOverlapWarnings = ({
    tasks,
    dailyRecords,
    projects,
    selectedProjectId,
}: {
    tasks: TaskLike[];
    dailyRecords: DailyRecordLike[];
    projects: ProjectLike[];
    selectedProjectId: string | number | null | undefined;
}): OverlapWarning[] => {
    if (!selectedProjectId) return [];

    const activeProject = (projects || []).find(p => p.id === Number(selectedProjectId));
    const currentProjectName = activeProject?.name || '現在の現場';

    const otherIntervals = buildOtherProjectIntervals(dailyRecords, selectedProjectId, projects);
    const { intervals: currentIntervals, warnings: invertedWarnings } =
        buildCurrentProjectIntervals(tasks, selectedProjectId, currentProjectName);

    return [...invertedWarnings, ...findOverlaps([...otherIntervals, ...currentIntervals])];
};
