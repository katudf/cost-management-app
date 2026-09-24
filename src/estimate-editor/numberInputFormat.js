/**
 * EstimateItemTable.jsx と SheetPaper.jsx に重複していた数値入力欄の
 * フォーマット/パースヘルパの一本化（§9.26）。
 */

// 負数は "▲" 表記にする（例: -1234 → ▲1,234）
export const formatNumberInput = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  const formatted = Math.abs(num).toLocaleString('ja-JP', { maximumFractionDigits: 10 });
  return num < 0 ? `▲${formatted}` : formatted;
};

// 数量欄用: 常に小数点以下1桁で表示（例: 5 → "5.0"）
export const formatQuantityInput = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  const formatted = Math.abs(num).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return num < 0 ? `▲${formatted}` : formatted;
};

// 全角数字・カンマを除去して数値文字列に戻す（末尾の小数点は入力途中として許容）
// 先頭の "▲" または "-"/"－" のみを負符号として扱う（それ以外の位置の同記号はカンマ除去のみ行い保持する）
export const parseNumberInput = (raw) => {
  const leadingSignMatch = raw.match(/^\s*([▲－-])/);
  const isNegative = !!leadingSignMatch;
  const rest = isNegative ? raw.slice(leadingSignMatch[0].length) : raw;
  const halfWidth = rest.replace(/[０-９．]/g, (c) =>
    c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const digits = halfWidth.replace(/,/g, '');
  return isNegative && digits !== '' ? `-${digits}` : digits;
};
