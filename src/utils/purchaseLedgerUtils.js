/**
 * PurchaseLedgerTab.jsx に3箇所べた書きされていた「金額が未入力のとき数量×単価で
 * 補完する」ロジックの一本化（§9.23）。
 *
 * 空文字は「未入力」を意味するため、数量・単価のいずれかが空文字の場合は
 * フォールバック計算をしない（Number('') は 0 になってしまい、誤って
 * 金額0円と表示されるのを防ぐ）。
 */
export const computeAmountFallback = (row) => {
    const rawAmount = row?.amount;
    if (rawAmount !== null && rawAmount !== undefined && rawAmount !== '') {
        const n = Number(rawAmount);
        return Number.isFinite(n) ? n : null;
    }

    if (row?.quantity === null || row?.quantity === undefined || row?.quantity === '') return null;
    if (row?.unit_price === null || row?.unit_price === undefined || row?.unit_price === '') return null;

    const q = Number(row.quantity);
    const p = Number(row.unit_price);
    if (isNaN(q) || isNaN(p)) return null;

    return q * p;
};
