import * as xlsx from 'xlsx-js-style';
import { ITEM_TYPE } from './constants';

const HONORIFICS = ['御中', '様', '殿'];
const CUSTOMER_SEARCH_ROWS = 20;

// 「株式会社X　御中」のように空白を挟んで末尾に付いた敬称（\s は全角スペースも含む）
const TRAILING_HONORIFIC = new RegExp(`\\s+(${HONORIFICS.join('|')})$`);

/** 末尾の敬称（空白区切り）を取り除く。残りが空なら null */
export const stripHonorific = (s) => {
    const name = String(s).trim().replace(TRAILING_HONORIFIC, '').trim();
    return name || null;
};

/**
 * 先頭付近の行から顧客名を探す。
 * - 「御中」「様」「殿」だけのセルがあれば、同じ行でその左にある最も近い文字列
 * - 「株式会社X　御中」のように空白＋敬称で終わるセルがあれば、敬称を除いた部分
 * @param {Array<Array>} rows sheet_to_json(header: 1) の結果
 * @returns {string|null}
 */
export const findCustomerNameByHonorific = (rows) => {
    for (const row of (rows || []).slice(0, CUSTOMER_SEARCH_ROWS)) {
        if (!Array.isArray(row)) continue;
        for (let i = 0; i < row.length; i++) {
            const cell = row[i];
            if (typeof cell !== 'string') continue;
            if (HONORIFICS.includes(cell.replace(/\s+/g, ''))) {
                for (let j = i - 1; j >= 0; j--) {
                    if (typeof row[j] === 'string' && row[j].trim() !== '') return stripHonorific(row[j]);
                }
            } else if (TRAILING_HONORIFIC.test(cell.trim())) {
                const name = stripHonorific(cell);
                if (name) return name;
            }
        }
    }
    return null;
};

/**
 * 1枚目のシートから顧客名を取り出す。敬称から探せればそれを優先し、
 * 見つからなければ従来様式の D13（文字列のときだけ。金額などの数値は顧客名にしない）を使う。
 * @param {object} sheet xlsx のシート
 * @param {Array<Array>} rows 同じシートの sheet_to_json(header: 1) の結果
 * @returns {string|null}
 */
export const extractCustomerName = (sheet, rows) => {
    const byHonorific = findCustomerNameByHonorific(rows);
    if (byHonorific) return byHonorific;
    const d13 = sheet?.['D13']?.v;
    return typeof d13 === 'string' ? stripHonorific(d13) : null;
};

/**
 * 見積書管理用：Excelファイルを忠実にパースする関数
 * 工種（カテゴリ）行を自動検出し、明細フィールドを個別に保持する
 *
 * 列構成（41行目以降の見積内訳明細書ページ）:
 *   A列(0)  = No.
 *   C列(2)  = 名称
 *   Y列(24) = 仕様
 *   AO列(40)= 数量
 *   AR列(43)= 単位
 *   AT列(45)= 単価
 *   AX列(49)= 金額
 *   BB列(53)= 摘要
 *
 * @param {File} file インポートするExcelファイル
 * @returns {Promise<{projectName: string, customerName: string, items: Array}>}
 */
export const parseExcelForEstimate = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target.result;
                const workbook = xlsx.read(data, { type: 'binary' });

                let extractedProjectName = null;
                let extractedCustomerName = null;
                const items = [];
                const comments = [];

                // シートごとの行配列（1枚目は顧客名の検出と明細の読み取りで共用する）
                const sheetRows = {};
                const getRows = (name) => {
                    if (!sheetRows[name]) sheetRows[name] = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
                    return sheetRows[name];
                };

                // 最初のシートから顧客名を取得（敬称の左 → 従来様式の D13 の順）
                const firstSheetName = workbook.SheetNames[0];
                if (firstSheetName) {
                    extractedCustomerName = extractCustomerName(workbook.Sheets[firstSheetName], getRows(firstSheetName));
                }

                // 工種シンボルの自動採番用
                const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                let categoryIndex = 0;

                workbook.SheetNames.forEach(sheetName => {
                    const rows = getRows(sheetName);

                    rows.forEach(row => {
                        // 工事名の抽出
                        if (!extractedProjectName) {
                            for (let i = 0; i < row.length; i++) {
                                const cell = row[i];
                                if (typeof cell === 'string' && cell.replace(/\s+/g, '') === '工事名') {
                                    for (let j = i + 1; j < row.length; j++) {
                                        if (row[j] && typeof row[j] === 'string' && row[j].trim() !== '') {
                                            extractedProjectName = row[j].trim();
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                        }

                        // 各列の値を取得
                        const no        = row[0];   // A列: No.
                        const name      = row[2];   // C列: 名称
                        const spec      = row[24];  // Y列: 仕様
                        const quantity  = row[40];  // AO列: 数量
                        const unit      = row[43];  // AR列: 単位
                        const unitPrice = row[45];  // AT列: 単価
                        const amount    = row[49];  // AX列: 金額
                        const note      = row[53];  // BB列: 摘要

                        // 名称がない行はスキップ
                        if (!name || typeof name !== 'string') return;

                        // 合計・小計・諸経費・値引行はスキップ
                        const trimmedName = name.replace(/\s+/g, '');
                        if (
                            trimmedName.includes('合計') ||
                            trimmedName.includes('小計') ||
                            trimmedName.includes('諸経費') ||
                            trimmedName.includes('値引')
                        ) return;

                        // ヘッダー行（「名称」「名　称」）はスキップ
                        if (trimmedName === '名称') return;

                        // コメント行の判定: C列(index=2)のみにデータがあり、他の列にデータがない行
                        const hasOtherData = row.some((c, ci) =>
                            ci !== 2 && c != null && c !== ''
                        );

                        if (!hasOtherData) {
                            // C列のみの行 → コメントとして収集
                            comments.push(name.trim());
                            return;
                        }

                        // 工種（カテゴリ）行の判定:
                        //   名称があり、数量が数値でない行 → 工種行と見なす
                        if (typeof quantity !== 'number') {
                            const nameStr = name.trim();

                            items.push({
                                item_type: ITEM_TYPE.CATEGORY,
                                category_symbol: symbols[categoryIndex] || String(categoryIndex + 1),
                                name: nameStr,
                                spec: null,
                                quantity: null,
                                unit: null,
                                unit_price: null,
                                amount: null,
                                note: null,
                                sort_order: items.length,
                            });
                            categoryIndex++;
                            return;
                        }

                        // 通常の明細行
                        items.push({
                            item_type: ITEM_TYPE.ITEM,
                            category_symbol: null,
                            name: name.trim(),
                            spec: spec ? String(spec).trim() : '',
                            quantity: quantity,
                            unit: unit ? String(unit).trim() : '',
                            unit_price: typeof unitPrice === 'number' ? unitPrice : (typeof amount === 'number' && quantity ? Math.round(amount / quantity) : ''),
                            amount: typeof amount === 'number' ? amount : '',
                            note: note ? String(note).trim() : '',
                            sort_order: items.length,
                        });
                    });
                });

                resolve({
                    projectName: extractedProjectName,
                    customerName: extractedCustomerName,
                    items,
                    notes: comments.length > 0 ? comments.join('\n') : null,
                });
            } catch (error) {
                console.error('Excel見積パースエラー:', error);
                reject(error);
            }
        };

        reader.onerror = (error) => {
            console.error('ファイル読み込みエラー:', error);
            reject(error);
        };

        reader.readAsBinaryString(file);
    });
};
