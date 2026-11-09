/**
 * 作業時間計算ユーティリティ
 * 
 * 夏季/冬季の休憩時間ルールに基づき、開始・終了時刻から
 * 実労働時間・時間外労働時間・人工数を自動算出する。
 */

// ============================================================
// 定数: 時刻を分単位 (0:00 = 0, 8:00 = 480, etc.) で管理
// ============================================================

/**
 * 'HH:MM' を 0:00 からの分数に変換する。空文字や null は null。
 *
 * 'HH' だけ・時刻でない文字列も null にする。以前の実装はこれらで NaN を返し、
 * NaN は比較がすべて false になるため、重複判定などを無言ですり抜けていた。
 *
 * 時刻→分の変換はこのモジュールが唯一の持ち主。
 * `timeOverlapUtils.ts` にも同じ関数が生えていたので、ここに寄せた。
 */
export const toMinutes = (timeStr: string | null | undefined): number | null => {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

export interface BreakRange {
    s: number;
    e: number;
}

export interface SeasonConfig {
    label: string;
    scheduledStart: number;
    scheduledEnd: number;
    breaks: BreakRange[];
    totalBreakMinutes: number;
    scheduledWorkHours: number;
}

const SEASON_CONFIGS: { summer: SeasonConfig; winter: SeasonConfig } = {
    summer: {
        label: '夏季',
        scheduledStart: toMinutes('08:00') as number,  // 480
        scheduledEnd: toMinutes('17:30') as number,    // 1050
        breaks: [
            { s: toMinutes('10:00') as number, e: toMinutes('10:30') as number },  // 30min
            { s: toMinutes('12:00') as number, e: toMinutes('13:00') as number },  // 60min
            { s: toMinutes('15:00') as number, e: toMinutes('15:30') as number },  // 30min
        ],
        totalBreakMinutes: 120,
        // 定時実労働時間: (17:30-8:00) - 120min = 9.5h - 2h = 7.5h
        scheduledWorkHours: 7.5,
    },
    winter: {
        label: '冬季',
        scheduledStart: toMinutes('08:00') as number,  // 480
        scheduledEnd: toMinutes('17:00') as number,    // 1020
        breaks: [
            { s: toMinutes('10:00') as number, e: toMinutes('10:15') as number },  // 15min
            { s: toMinutes('12:00') as number, e: toMinutes('13:00') as number },  // 60min
            { s: toMinutes('15:00') as number, e: toMinutes('15:15') as number },  // 15min
        ],
        totalBreakMinutes: 90,
        // 定時実労働時間: (17:00-8:00) - 90min = 9h - 1.5h = 7.5h
        scheduledWorkHours: 7.5,
    },
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ============================================================
// 季節の対象月（就業規則）
// ============================================================

export interface SeasonRule {
    /** この規則を適用する最初の日 "YYYY-MM-DD"。null は最初の規則（期限なし） */
    from: string | null;
    /** 冬季の月（1-12）。それ以外の月は夏季 */
    winterMonths: number[];
}

/**
 * 就業規則の季節区分。新しい規則を先頭に置く。
 * 規則が変わる前の日報を編集し直しても、当時の季節で計算されるように古い規則も残す。
 */
export const SEASON_RULES: SeasonRule[] = [
    { from: '2026-11-01', winterMonths: [12, 1, 2] },
    { from: null, winterMonths: [11, 12, 1, 2] },
];

/** "YYYY-MM-DD"（後ろに時刻が付いていてもよい）を年月日に分ける。タイムゾーンに依存しないよう文字列から読む */
const parseDateParts = (dateStr: string): { ymd: string; month: number } | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (match) return { ymd: match[0], month: Number(match[2]) };
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    const month = date.getMonth() + 1;
    return { ymd: `${date.getFullYear()}-${pad(month)}-${pad(date.getDate())}`, month };
};

const findSeasonRule = (ymd: string): SeasonRule =>
    SEASON_RULES.find(rule => rule.from === null || rule.from <= ymd) as SeasonRule;

const seasonOf = (rule: SeasonRule, month: number): SeasonConfig =>
    rule.winterMonths.includes(month) ? SEASON_CONFIGS.winter : SEASON_CONFIGS.summer;

// ============================================================
// getSeasonConfig: 日付から夏季/冬季の設定を取得
// ============================================================

/**
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {SeasonConfig} シーズン設定（日付が無い・読めないときは夏季）
 */
export const getSeasonConfig = (dateStr: string | null | undefined): SeasonConfig => {
    const parts = dateStr ? parseDateParts(dateStr) : null;
    if (!parts) return SEASON_CONFIGS.summer;
    return seasonOf(findSeasonRule(parts.ymd), parts.month);
};

/** その日の季節の標準の休憩の長さ（分）。休憩設定を保存していない日に使う */
export const getStandardBreakDurations = (dateStr: string | null | undefined): number[] =>
    getSeasonConfig(dateStr).breaks.map(brk => brk.e - brk.s);

/**
 * 保存済みの休憩の長さを、その日の季節に合わせて読み直す。
 *
 * 休憩の長さは日報を送るたびに保存される。就業規則が変わって季節が入れ替わった日
 * （2026年11月: 冬季 → 夏季）には、旧規則の季節の標準値がそのまま保存されている。
 * それを新しい季節の休憩時刻に当てると、夏季の終業 17:30 に冬季の短い休憩が混ざるので、
 * 「旧規則の季節の標準値と同じ値」は新しい季節の標準値に読み替える。
 * 配列でない・休憩の数が合わない値も標準値にする。
 */
export const resolveSavedBreakDurations = (
    saved: unknown,
    dateStr: string | null | undefined
): number[] => {
    const standard = getStandardBreakDurations(dateStr);
    if (!Array.isArray(saved) || saved.length !== standard.length) return standard;
    const durations = saved.map(value => Number(value));
    if (durations.some(value => !Number.isFinite(value))) return standard;
    const parts = dateStr ? parseDateParts(dateStr) : null;
    if (parts) {
        const ruleIndex = SEASON_RULES.indexOf(findSeasonRule(parts.ymd));
        const previousRule = SEASON_RULES[ruleIndex + 1];
        if (previousRule) {
            const previousSeason = seasonOf(previousRule, parts.month);
            if (previousSeason !== getSeasonConfig(dateStr)) {
                const previousStandard = previousSeason.breaks.map(brk => brk.e - brk.s);
                if (previousStandard.every((value, i) => value === durations[i])) return standard;
            }
        }
    }
    return durations;
};

// ============================================================
// 重複計算ヘルパー (2つの時間範囲の重なり)
// ============================================================

const overlapMinutes = (aStart: number, aEnd: number, bStart: number, bEnd: number): number => {
    const start = Math.max(aStart, bStart);
    const end = Math.min(aEnd, bEnd);
    return Math.max(0, end - start);
};

// ============================================================
// calculateWorkHours: メイン計算関数
// ============================================================

export interface WorkHoursResult {
    grossMinutes: number;
    breakMinutes: number;
    netWorkHours: number;
    /** 時間外の合計（早出 + 残業） */
    overtimeHours: number;
    /** 早出: 定時開始前の時間外。職長の承認は不要 */
    earlyOvertimeHours: number;
    /** 残業: 定時終了後の時間外（日をまたいだ分を含む）。職長の承認が必要 */
    lateOvertimeHours: number;
    regularHours: number;
}

/**
 * @param {string} startTime - "HH:MM"
 * @param {string} endTime   - "HH:MM"
 * @param {string} dateStr   - "YYYY-MM-DD"
 * @param {boolean} isOvernight - 翌日（日跨ぎ）フラグ
 * @returns {WorkHoursResult} { grossMinutes, breakMinutes, netWorkHours, overtimeHours, regularHours }
 */
export const calculateWorkHours = (
    startTime: string | null | undefined, 
    endTime: string | null | undefined, 
    dateStr: string | null | undefined, 
    isOvernight = false,
    breakDurations?: number[]
): WorkHoursResult => {
    const startMin = toMinutes(startTime);
    let endMin = toMinutes(endTime);

    if (startMin === null || endMin === null) {
        return {
            grossMinutes: 0,
            breakMinutes: 0,
            netWorkHours: 0,
            overtimeHours: 0,
            earlyOvertimeHours: 0,
            lateOvertimeHours: 0,
            regularHours: 0,
        };
    }

    if (isOvernight) {
        endMin += 1440; // 24時間を追加
    }

    if (endMin <= startMin) {
        return {
            grossMinutes: 0,
            breakMinutes: 0,
            netWorkHours: 0,
            overtimeHours: 0,
            earlyOvertimeHours: 0,
            lateOvertimeHours: 0,
            regularHours: 0,
        };
    }

    const config = getSeasonConfig(dateStr);
    const grossMinutes = endMin - startMin;

    // 日別設定があれば標準休憩の長さだけを調整する（休憩時刻は移動しない）。
    const breaks = breakDurations
        ? config.breaks.map((brk, index) => ({
            s: brk.s,
            e: brk.s + Math.min(brk.e - brk.s, Math.max(0, Number(breakDurations[index] ?? (brk.e - brk.s)))),
        }))
        : config.breaks;

    // 作業時間帯と重複する休憩時間を計算
    let breakMinutes = 0;
    breaks.forEach(brk => {
        // 通常の休憩時間との重複
        breakMinutes += overlapMinutes(startMin, endMin, brk.s, brk.e);
        
        // 翌日（+1440分）の休憩時間とも重複チェック
        if (isOvernight) {
            breakMinutes += overlapMinutes(startMin, endMin, brk.s + 1440, brk.e + 1440);
        }
    });

    const netWorkMinutes = grossMinutes - breakMinutes;
    const netWorkHours = netWorkMinutes / 60;

    // 時間外 (早出 + 残業) の算出
    // 早出: 定時開始前に働いた時間（休憩重複を除く）
    let earlyOvertimeMinutes = 0;
    if (startMin < config.scheduledStart) {
        const earlyEnd = Math.min(endMin, config.scheduledStart);
        let earlyGross = earlyEnd - startMin;
        // 早出時間帯の休憩重複を控除
        breaks.forEach(brk => {
            earlyGross -= overlapMinutes(startMin, earlyEnd, brk.s, brk.e);
        });
        earlyOvertimeMinutes = Math.max(0, earlyGross);
    }

    // 残業: 定時終了後に働いた時間（休憩重複を除く）
    let lateOvertimeMinutes = 0;
    // (通常 + 翌日の定時終了以降も残業とする）
    if (endMin > config.scheduledEnd) {
        const lateStart = Math.max(startMin, config.scheduledEnd);
        let lateGross = endMin - lateStart;
        // 残業時間帯の休憩重複を控除
        breaks.forEach(brk => {
            lateGross -= overlapMinutes(lateStart, endMin, brk.s, brk.e);
            if (isOvernight) {
               lateGross -= overlapMinutes(lateStart, endMin, brk.s + 1440, brk.e + 1440);
            }
        });
        lateOvertimeMinutes = Math.max(0, lateGross);
    }

    const overtimeMinutes = earlyOvertimeMinutes + lateOvertimeMinutes;
    const overtimeHours = overtimeMinutes / 60;
    const regularHours = Math.max(0, netWorkHours - overtimeHours);
    // 合計と内訳が丸めでずれないよう、残業は「丸めた合計 − 丸めた早出」で出す
    const roundedOvertime = round2(overtimeHours);
    const roundedEarly = round2(earlyOvertimeMinutes / 60);

    return {
        grossMinutes,
        breakMinutes,
        netWorkHours: round2(netWorkHours),
        overtimeHours: roundedOvertime,
        earlyOvertimeHours: roundedEarly,
        lateOvertimeHours: round2(roundedOvertime - roundedEarly),
        regularHours: round2(regularHours),
    };
};

// ============================================================
// splitRecordOvertime: 保存済み日報の時間外を 早出 / 残業 に分ける
// ============================================================

export interface OvertimeSplit {
    total: number;
    early: number;
    late: number;
}

/**
 * TaskRecords の行（overtime_hours = 時間外の合計、early_overtime_hours = うち早出）から内訳を出す。
 * 早出の列が無い・空の行（管理者が時間数だけで入力した行など）は、すべて残業として扱う。
 */
export const splitRecordOvertime = (
    record: { overtime_hours?: number | string | null; early_overtime_hours?: number | string | null } | null | undefined
): OvertimeSplit => {
    const total = Math.max(0, Number(record?.overtime_hours) || 0);
    const early = Math.min(total, Math.max(0, Number(record?.early_overtime_hours) || 0));
    return { total, early, late: round2(total - early) };
};

// ============================================================
// calculateNinku: 人工数の算出
// ============================================================

/**
 * @param {number} totalWorkHours - その現場の合計実労働時間
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {number} 人工数 (小数第1位)
 */
export const calculateNinku = (totalWorkHours: number, dateStr: string | null | undefined): number =>
    roundNinku(calculateNinkuExact(totalWorkHours, dateStr));

/**
 * 丸める前の人工数。複数の日報を合算するときはこちらで足してから最後に roundNinku で丸める
 * （1件ずつ 0.1 単位に丸めてから足すと、0.33 人工 × 3 件が 0.9 人工になるなど合計がずれるため）。
 */
export const calculateNinkuExact = (totalWorkHours: number, dateStr: string | null | undefined): number => {
    const config = getSeasonConfig(dateStr);
    if (config.scheduledWorkHours <= 0) return 0;
    return totalWorkHours / config.scheduledWorkHours;
};

/** 人工数を表示用に小数第1位へ丸める */
export const roundNinku = (ninku: number): number => Math.round(ninku * 10) / 10;

// ============================================================
// formatTimeDisplay: 時刻の表示用フォーマット
// ============================================================

export const formatTimeDisplay = (timeStr: string | null | undefined): string => {
    if (!timeStr) return '';
    // "HH:MM:SS" → "HH:MM" or "HH:MM" → "HH:MM"
    return timeStr.substring(0, 5);
};
