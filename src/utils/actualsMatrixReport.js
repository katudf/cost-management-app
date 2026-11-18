// 実績入力のマトリックスを月ごとの人工表にまとめる（画面・ファイルに依存しない純関数）
// 1か月＝1ページ。作業員×日付のセルは人工（7.5時間＝1人工。換算は workTimeUtils に従う）で、
// 右端に「月合計」「累計（案件の最初の実績からその月末まで）」、最下段に「合計」行を持つ。
import { calculateNinkuExact, roundNinku } from './workTimeUtils';
import { isActualHoliday } from './holidayUtils';

export const OTHER_ROW_LABEL = 'その他（期間外のみ実績）';
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

const pad2 = (n) => String(n).padStart(2, '0');
const toMonthKey = (dateStr) => String(dateStr).slice(0, 7);

/** 'YYYY-MM' の開始月〜終了月を昇順で並べる。開始が終了より後ならそのまま入れ替える */
export const listMonths = (startMonth, endMonth) => {
    const [from, to] = startMonth <= endMonth ? [startMonth, endMonth] : [endMonth, startMonth];
    const months = [];
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
        months.push(`${y}-${pad2(m)}`);
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return months;
};

/** その月の日付一覧。休日判定は画面のマトリックスと同じ（会社休日は実際の休業日のみ） */
const buildDates = (monthKey, holidays) => {
    const [year, month] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${monthKey}-${pad2(day)}`;
        const dow = new Date(year, month - 1, day).getDay();
        const registered = (holidays || []).find(h => h.date === dateStr);
        return {
            day,
            dateStr,
            dow,
            dowLabel: DOW_LABELS[dow],
            isSunday: dow === 0,
            isSaturday: dow === 6,
            isHoliday: isActualHoliday(registered),
        };
    });
};

/**
 * @param {Object} params
 * @param {Array} params.records - 日報 [{worker, date:'YYYY-MM-DD', hours}]
 * @param {Array<string>} params.orderedNames - 作業員の並び順（画面と同じ順。ここに無い人は末尾に名前順で足す）
 * @param {Array} params.holidays - 会社休日 [{date, description}]
 * @param {string} params.startMonth - 'YYYY-MM'
 * @param {string} params.endMonth - 'YYYY-MM'
 * @returns {{ months: Array }}
 *   months[i] = { monthKey, label, dates, rows:[{name, cells, monthTotal, cumulative}],
 *                 otherRow: null | {name, cumulative}, total:{cells, monthTotal, cumulative} }
 *   cells は日ごとの人工（小数第1位に丸め済み。実績が無い日は null）
 */
export const buildActualsMatrixReport = ({ records, orderedNames = [], holidays = [], startMonth, endMonth }) => {
    const monthKeys = listMonths(startMonth, endMonth);

    // 作業員×日の時間を合算する（同じ日の複数日報は丸める前に足す）
    const hoursByWorkerDate = {};
    for (const r of records || []) {
        if (!r.worker || !r.date) continue;
        const hours = Number(r.hours || 0);
        if (!(hours > 0)) continue;
        const date = String(r.date).slice(0, 10);
        const byDate = (hoursByWorkerDate[r.worker] ||= {});
        byDate[date] = (byDate[date] || 0) + hours;
    }
    // 人工（丸める前）。日付ごとに季節の所定時間が変わりうるので、日単位で換算する
    const exactByWorkerDate = {};
    for (const [worker, byDate] of Object.entries(hoursByWorkerDate)) {
        exactByWorkerDate[worker] = {};
        for (const [date, hours] of Object.entries(byDate)) {
            exactByWorkerDate[worker][date] = calculateNinkuExact(hours, date);
        }
    }

    // 行に出す作業員: 選択期間のどこかで実績がある人。順序は画面と同じ
    const inRange = (date) => {
        const key = toMonthKey(date);
        return key >= monthKeys[0] && key <= monthKeys[monthKeys.length - 1];
    };
    const allWorkers = Object.keys(exactByWorkerDate);
    const activeWorkers = new Set(
        allWorkers.filter(w => Object.keys(exactByWorkerDate[w]).some(inRange))
    );
    const rank = new Map(orderedNames.map((name, i) => [name, i]));
    const rowNames = [...activeWorkers].sort((a, b) => {
        const ra = rank.has(a) ? rank.get(a) : Infinity;
        const rb = rank.has(b) ? rank.get(b) : Infinity;
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, 'ja');
    });
    const otherWorkers = allWorkers.filter(w => !activeWorkers.has(w));

    // その月の末日までの累計（丸める前）
    const cumulativeUntil = (worker, monthKey) =>
        Object.entries(exactByWorkerDate[worker] || {})
            .filter(([date]) => toMonthKey(date) <= monthKey)
            .reduce((sum, [, v]) => sum + v, 0);

    const months = monthKeys.map((monthKey) => {
        const dates = buildDates(monthKey, holidays);
        const [year, month] = monthKey.split('-').map(Number);

        const dailyExactTotals = dates.map(() => 0);
        const dailyHasData = dates.map(() => false);
        let monthExactTotal = 0;
        let cumulativeExactTotal = 0;

        const rows = rowNames.map((name) => {
            let monthExact = 0;
            const cells = dates.map((d, i) => {
                const exact = exactByWorkerDate[name]?.[d.dateStr];
                if (exact === undefined) return null;
                monthExact += exact;
                dailyExactTotals[i] += exact;
                dailyHasData[i] = true;
                return roundNinku(exact);
            });
            const cumulativeExact = cumulativeUntil(name, monthKey);
            monthExactTotal += monthExact;
            cumulativeExactTotal += cumulativeExact;
            return {
                name,
                cells,
                monthTotal: monthExact > 0 ? roundNinku(monthExact) : null,
                cumulative: roundNinku(cumulativeExact),
            };
        });

        // 選択期間に実績が無く、それ以前（または以後）にだけ実績がある人は累計だけを1行にまとめる
        let otherRow = null;
        const otherExact = otherWorkers.reduce((sum, w) => sum + cumulativeUntil(w, monthKey), 0);
        if (otherExact > 0) {
            otherRow = { name: OTHER_ROW_LABEL, cumulative: roundNinku(otherExact) };
            cumulativeExactTotal += otherExact;
        }

        return {
            monthKey,
            label: `${year}年${month}月`,
            dates,
            rows,
            otherRow,
            total: {
                cells: dailyExactTotals.map((v, i) => (dailyHasData[i] ? roundNinku(v) : null)),
                monthTotal: roundNinku(monthExactTotal),
                cumulative: roundNinku(cumulativeExactTotal),
            },
        };
    });

    return { months };
};

/** 出力の期間ラベル（例: 2026年3月 / 2026年3月〜2026年5月） */
export const formatPeriodLabel = (startMonth, endMonth) => {
    const keys = listMonths(startMonth, endMonth);
    const fmt = (k) => { const [y, m] = k.split('-').map(Number); return `${y}年${m}月`; };
    return keys.length === 1 ? fmt(keys[0]) : `${fmt(keys[0])}〜${fmt(keys[keys.length - 1])}`;
};

/** 人工の表示文字列（小数第1位。null は空欄） */
export const formatNinku = (v) => (v === null || v === undefined ? '' : v.toFixed(1));
