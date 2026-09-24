/**
 * PurchaseLedgerTab.jsx にべた書きされていたCSVインポート用の純関数群の一本化（§9.24）。
 * いずれもReactの状態を持たない純粋関数で、テストが存在しなかったため個別にテストを追加する。
 */

// ヘッダー文字列 → PurchaseRecords カラムの対応（scripts/upload_purchase_ledger.js と同じ突き合わせ方針）
export const buildCsvColMap = (headerCells) => ({
    date: headerCells.findIndex(h => h.includes('月/日') || h.includes('日付')),
    project_name: headerCells.findIndex(h => h.includes('工事名')),
    supplier: headerCells.findIndex(h => h.includes('購入先') || h.includes('仕入先')),
    item_name: headerCells.findIndex(h => h.includes('名称') || h.includes('品名')),
    note: headerCells.findIndex(h => h.includes('備考')),
    quantity: headerCells.findIndex(h => h.includes('数量')),
    unit: headerCells.findIndex(h => h === '単位' || (h.includes('単位') && !h.includes('単価'))),
    unit_price: headerCells.findIndex(h => h.includes('単価')),
    amount: headerCells.findIndex(h => h.includes('金額'))
});

// RFC4180 準拠の簡易CSVパーサ（ダブルクォート内のカンマ・改行・"" を扱う）
export const parseCsv = (text) => {
    const clean = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (inQuotes) {
            if (c === '"') {
                if (clean[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\r') {
            // \r\n の \r は無視
        } else if (c === '\n') {
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
};

// 各種日付表記を ISO(YYYY-MM-DD) へ正規化。空・不正なら null
export const normalizeCsvDate = (raw) => {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // Excelシリアル値
    if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 40000) {
        const d = new Date((Number(s) - 25569) * 86400 * 1000);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    }
    const m = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) {
        const [, y, mo, d] = m;
        const pad = (n) => String(n).padStart(2, '0');
        const iso = `${y}-${pad(mo)}-${pad(d)}`;
        const dd = new Date(iso);
        return isNaN(dd.getTime()) ? null : iso;
    }
    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
};

// 数値セル → number | null（カンマ・円記号・空白を許容）
export const parseNumericCell = (raw) => {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).replace(/[,¥\s]/g, '').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};
