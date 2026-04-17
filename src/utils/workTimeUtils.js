/**
 * 作業時間計算ユーティリティ
 * 
 * 夏季/冬季の休憩時間ルールに基づき、開始・終了時刻から
 * 実労働時間・時間外労働時間・人工数を自動算出する。
 */

// ============================================================
// 定数: 時刻を分単位 (0:00 = 0, 8:00 = 480, etc.) で管理
// ============================================================

const toMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};

const SEASON_CONFIGS = {
    summer: {
        label: '夏季',
        scheduledStart: toMinutes('08:00'),  // 480
        scheduledEnd: toMinutes('17:30'),    // 1050
        breaks: [
            { s: toMinutes('10:00'), e: toMinutes('10:30') },  // 30min
            { s: toMinutes('12:00'), e: toMinutes('13:00') },  // 60min
            { s: toMinutes('15:00'), e: toMinutes('15:30') },  // 30min
        ],
        totalBreakMinutes: 120,
        // 定時実労働時間: (17:30-8:00) - 120min = 9.5h - 2h = 7.5h
        scheduledWorkHours: 7.5,
    },
    winter: {
        label: '冬季',
        scheduledStart: toMinutes('08:00'),  // 480
        scheduledEnd: toMinutes('17:00'),    // 1020
        breaks: [
            { s: toMinutes('10:00'), e: toMinutes('10:15') },  // 15min
            { s: toMinutes('12:00'), e: toMinutes('13:00') },  // 60min
            { s: toMinutes('15:00'), e: toMinutes('15:15') },  // 15min
        ],
        totalBreakMinutes: 90,
        // 定時実労働時間: (17:00-8:00) - 90min = 9h - 1.5h = 7.5h
        scheduledWorkHours: 7.5,
    },
};

// ============================================================
// getSeasonConfig: 日付から夏季/冬季の設定を取得
// ============================================================

/**
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {object} シーズン設定
 */
export const getSeasonConfig = (dateStr) => {
    if (!dateStr) return SEASON_CONFIGS.summer;
    const month = new Date(dateStr).getMonth() + 1; // 1-12
    // 夏季: 3月〜10月, 冬季: 11月〜2月
    if (month >= 3 && month <= 10) {
        return SEASON_CONFIGS.summer;
    }
    return SEASON_CONFIGS.winter;
};

// ============================================================
// 重複計算ヘルパー (2つの時間範囲の重なり)
// ============================================================

const overlapMinutes = (aStart, aEnd, bStart, bEnd) => {
    const start = Math.max(aStart, bStart);
    const end = Math.min(aEnd, bEnd);
    return Math.max(0, end - start);
};

// ============================================================
// calculateWorkHours: メイン計算関数
// ============================================================

/**
 * @param {string} startTime - "HH:MM"
 * @param {string} endTime   - "HH:MM"
 * @param {string} dateStr   - "YYYY-MM-DD"
 * @returns {object} { grossMinutes, breakMinutes, netWorkHours, overtimeHours, regularHours }
 */
export const calculateWorkHours = (startTime, endTime, dateStr) => {
    const startMin = toMinutes(startTime);
    const endMin = toMinutes(endTime);

    if (startMin === null || endMin === null || endMin <= startMin) {
        return {
            grossMinutes: 0,
            breakMinutes: 0,
            netWorkHours: 0,
            overtimeHours: 0,
            regularHours: 0,
        };
    }

    const config = getSeasonConfig(dateStr);
    const grossMinutes = endMin - startMin;

    // 作業時間帯と重複する休憩時間を計算
    let breakMinutes = 0;
    config.breaks.forEach(brk => {
        breakMinutes += overlapMinutes(startMin, endMin, brk.s, brk.e);
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
        config.breaks.forEach(brk => {
            earlyGross -= overlapMinutes(startMin, earlyEnd, brk.s, brk.e);
        });
        earlyOvertimeMinutes = Math.max(0, earlyGross);
    }

    // 残業: 定時終了後に働いた時間（休憩重複を除く）
    let lateOvertimeMinutes = 0;
    if (endMin > config.scheduledEnd) {
        const lateStart = Math.max(startMin, config.scheduledEnd);
        let lateGross = endMin - lateStart;
        // 残業時間帯の休憩重複を控除
        config.breaks.forEach(brk => {
            lateGross -= overlapMinutes(lateStart, endMin, brk.s, brk.e);
        });
        lateOvertimeMinutes = Math.max(0, lateGross);
    }

    const overtimeMinutes = earlyOvertimeMinutes + lateOvertimeMinutes;
    const overtimeHours = overtimeMinutes / 60;
    const regularHours = Math.max(0, netWorkHours - overtimeHours);

    return {
        grossMinutes,
        breakMinutes,
        netWorkHours: Math.round(netWorkHours * 100) / 100,
        overtimeHours: Math.round(overtimeHours * 100) / 100,
        regularHours: Math.round(regularHours * 100) / 100,
    };
};

// ============================================================
// calculateNinku: 人工数の算出
// ============================================================

/**
 * @param {number} totalWorkHours - その現場の合計実労働時間
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {number} 人工数 (小数第1位)
 */
export const calculateNinku = (totalWorkHours, dateStr) => {
    const config = getSeasonConfig(dateStr);
    if (config.scheduledWorkHours <= 0) return 0;
    return Math.round((totalWorkHours / config.scheduledWorkHours) * 10) / 10;
};

// ============================================================
// formatTimeDisplay: 時刻の表示用フォーマット
// ============================================================

export const formatTimeDisplay = (timeStr) => {
    if (!timeStr) return '';
    // "HH:MM:SS" → "HH:MM" or "HH:MM" → "HH:MM"
    return timeStr.substring(0, 5);
};
