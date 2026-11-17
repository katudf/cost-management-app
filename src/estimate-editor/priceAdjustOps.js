// 単価の一括調整（掛率）の純関数。
//
// 対象行の単価に掛率（％）を掛け、指定の単位・方法で端数を丸める。
//   - 単価のある行: 単価に掛ける。金額が「数量×単価」の自動計算なら新しい単価で計算し直し、
//     手で上書きした金額なら金額にも掛けて同じ端数処理をする
//   - 金額だけの行（単価が空）: 金額に掛けて同じ端数処理をする
//   - 値引きなどマイナスの行、リンク行（単価・金額がリンクで決まる）は触らずに数える
//   - 工種行・コメント行と、単価も金額も空の行は対象外（数えない）
import { ITEM_TYPE } from '../utils/constants';
import { computeAutoAmount } from './estimateCalc';

export const ROUND_UNITS = [1, 10, 100];
export const ROUND_MODES = [
  { value: 'floor', label: '切り捨て' },
  { value: 'round', label: '四捨五入' },
  { value: 'ceil', label: '切り上げ' },
];

const hasValue = (v) => v !== '' && v != null && Number.isFinite(Number(v));

/** value × percent% を unit 単位で丸める（浮動小数の誤差で 900 が 899 にならないよう先に整える） */
export const adjustValue = (value, percent, unit = 1, mode = 'floor') => {
  const raw = Math.round(Number(value) * Number(percent) * 1e4) / 1e6; // ×percent/100（小数4桁まで）
  const x = raw / unit;
  const fixed = Math.round(x * 1e6) / 1e6;
  const r = mode === 'ceil' ? Math.ceil(fixed) : mode === 'round' ? Math.round(fixed) : Math.floor(fixed);
  return r * unit;
};

/** 掛率として使える値か（0より大きい数） */
export const isValidPercent = (percent) => hasValue(percent) && Number(percent) > 0;

/** 打ち間違いを疑う掛率か（50%未満・200%超。例: 90 のつもりの 9 や 900） */
export const isUnusualPercent = (percent) => Number(percent) < 50 || Number(percent) > 200;

/** 金額が「数量×単価」の自動計算どおりか（手で上書きしていないか） */
const isAutoAmount = (row) =>
  hasValue(row.quantity) && hasValue(row.unit_price) && hasValue(row.amount) &&
  Math.abs(Number(row.amount) - Number(row.quantity) * Number(row.unit_price)) < 0.005;

/**
 * 対象行（uids）の単価・金額に掛率を掛ける。
 * @param items 明細（生の items）
 * @param uids  対象行の _uid の Set（配列でもよい）
 * @param { percent, unit, mode }
 * @returns { items, changed, skippedNegative, skippedLinked }  items は変更が無ければ元の配列
 */
export const adjustPrices = (items, uids, { percent, unit = 1, mode = 'floor' }) => {
  const target = uids instanceof Set ? uids : new Set(uids);
  let changed = 0;
  let skippedNegative = 0;
  let skippedLinked = 0;
  if (!isValidPercent(percent)) return { items, changed, skippedNegative, skippedLinked };
  const adj = (v) => adjustValue(v, percent, unit, mode);

  const next = items.map((row) => {
    if (!target.has(row._uid) || row.item_type !== ITEM_TYPE.ITEM) return row;
    const price = hasValue(row.unit_price) ? Number(row.unit_price) : null;
    const amount = hasValue(row.amount) ? Number(row.amount) : null;
    if (price == null && amount == null) return row; // 空行など
    if (row.linked_sheet_id != null || row.linked_category_item_id != null) {
      skippedLinked += 1;
      return row;
    }
    if ((price != null && price < 0) || (amount != null && amount < 0)) {
      skippedNegative += 1;
      return row;
    }
    let out;
    if (price != null) {
      const auto = isAutoAmount(row);
      out = { ...row, unit_price: adj(price) };
      if (auto) out = computeAutoAmount(out);
      else if (amount != null) out.amount = adj(amount);
    } else {
      out = { ...row, amount: adj(amount) };
    }
    if (out.unit_price === row.unit_price && out.amount === row.amount) return row;
    changed += 1;
    return out;
  });
  return { items: changed ? next : items, changed, skippedNegative, skippedLinked };
};

/**
 * 掛率で変えられる行（明細行で単価か金額が入っていて、マイナスでもリンク行でもない）の数。
 * 画面の対象件数表示用（adjustPrices が変更対象にする行と同じ判定）
 */
export const countAdjustableRows = (items, uids) => {
  const target = uids instanceof Set ? uids : new Set(uids);
  return items.filter((r) => {
    if (!target.has(r._uid) || r.item_type !== ITEM_TYPE.ITEM) return false;
    if (!hasValue(r.unit_price) && !hasValue(r.amount)) return false;
    if (r.linked_sheet_id != null || r.linked_category_item_id != null) return false;
    return !(Number(r.unit_price) < 0 || Number(r.amount) < 0);
  }).length;
};
