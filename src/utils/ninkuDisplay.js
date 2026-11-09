import { roundNinku } from './workTimeUtils';

/** 配置表・作業員画面の人工表示に添える説明（日報ベースへ切り替えたら文言も変える） */
export const NINKU_SOURCE_NOTE = '消化人工は配置表の配置実績から算出（仮。作業日報は今日まで、配置表は基準日まで）。目標人工は配置表で現場ごとに入力';

/**
 * 人工の基準日の表示（配置表の人工列の見出し・Excel出力の見出し）。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} [todayStr] 'YYYY-MM-DD'。年が違うときだけ年を付ける
 * @returns {string} 例: '11/12時点'（年が今年と違うときは '2025/11/12時点'）
 */
export function formatNinkuAsOfLabel(dateStr, todayStr = '') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return '';
    const md = `${Number(m[2])}/${Number(m[3])}`;
    const sameYear = !todayStr || String(todayStr).slice(0, 4) === m[1];
    return `${sameYear ? md : `${m[1]}/${md}`}時点`;
}

/**
 * 現場の「消化人工/目標人工」の表示文字列を作る。
 * - 消化人工: 小数第1位まで（端数がなければ整数）
 * - 目標人工: 配置表で入力した整数（管理シートの工種の目標時間とは別管理）
 * - 目標未設定（null）で消化があれば「12/－」、どちらも無ければ空文字
 *
 * @param {number} consumedNinku 消化人工（丸める前）
 * @param {number|null|undefined} targetNinku 目標人工（未設定は null）
 * @returns {string}
 */
export function formatNinkuRatio(consumedNinku, targetNinku) {
    const consumed = roundNinku(Number(consumedNinku) || 0);
    const hasTarget = targetNinku !== null && targetNinku !== undefined && targetNinku !== '';
    if (!hasTarget && consumed <= 0) return '';
    const consumedStr = Number.isInteger(consumed) ? String(consumed) : consumed.toFixed(1);
    const targetStr = hasTarget ? String(Math.floor(Number(targetNinku))) : '－';
    return `${consumedStr}/${targetStr}`;
}

/** 数値入力欄が「数値として読めない入力」だったことを表す印（parseTargetNinkuInput は不正として扱う） */
export const INVALID_NINKU_INPUT = Symbol('invalidNinkuInput');

/**
 * 現場ごとの人工の状態から、projectId → 表示文字列 の対応を作る（配置表の画面とExcel出力で共通）。
 * @param {Record<number, {consumedNinku: number, targetNinku: number|null}>} ninkuByProject
 * @returns {Record<number, string>}
 */
export function formatNinkuLabels(ninkuByProject) {
    const labels = {};
    Object.entries(ninkuByProject || {}).forEach(([id, v]) => {
        labels[id] = formatNinkuRatio(v.consumedNinku, v.targetNinku);
    });
    return labels;
}

/**
 * 目標人工の入力値を検証して保存用の値にする。
 * 空欄は未設定（null）。0以上の整数だけ受け付け、それ以外は undefined（不正）を返す。
 *
 * @param {string} input
 * @returns {number|null|undefined}
 */
export function parseTargetNinkuInput(input) {
    if (input === INVALID_NINKU_INPUT) return undefined;
    const s = String(input ?? '').trim();
    if (s === '') return null;
    if (!/^\d+$/.test(s)) return undefined;
    const n = Number(s);
    return Number.isSafeInteger(n) && n <= 2147483647 ? n : undefined;
}
