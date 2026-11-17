import * as xlsx from 'xlsx-js-style';
import { ITEM_TYPE, ITEM_SENTINEL } from './constants';

const HONORIFICS = ['御中', '様', '殿'];
const CUSTOMER_SEARCH_ROWS = 20;
// グループ（工種）見出しとみなす先頭の記号。「■」等の記号か、鏡あり様式の「A.」「Ｂ．」「C)」のような英字＋区切り
// （英字はシステム側で振り直すので、取込時に外す）
const GROUP_MARK = /^(?:[■□◆◇●○◎★☆]|[A-ZＡ-Ｚ]\s*[.．、:：)）])\s*/;
// 表紙の「備考」欄の内容として下に続けて読む最大行数
const NOTES_MAX_LINES = 10;

/**
 * シートを行配列にする。列位置（C列=名称 等）を固定で読むため、A列・1行目が空のシートでも
 * 必ず A1 起点で並べる（sheet_to_json は既定でシートの使用範囲の左上を起点にし、列番号がずれる）
 * @param {object} sheet xlsx のシート
 * @returns {Array<Array>}
 */
export const sheetToRowsFromA1 = (sheet) => {
    if (!sheet || !sheet['!ref']) return [];
    const range = xlsx.utils.decode_range(sheet['!ref']);
    range.s.c = 0;
    range.s.r = 0;
    return xlsx.utils.sheet_to_json(sheet, { header: 1, range });
};

const isBlankCell = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const isTableHeaderRow = (row) =>
    Array.isArray(row) && typeof row[2] === 'string' && row[2].replace(/\s+/g, '') === '名称';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Excel の日付（シリアル値・Date・「2026年12月30日」「2026/12/30」等の文字列）を YYYY-MM-DD にする。読めなければ null
 * @param {*} v セルの値
 * @returns {string|null}
 */
export const toIsoDate = (v) => {
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
        const d = xlsx.SSF.parse_date_code(v);
        return d && d.y ? `${d.y}-${pad2(d.m)}-${pad2(d.d)}` : null;
    }
    if (typeof v === 'string') {
        const m = v.trim().match(/^(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?$/);
        if (!m) return null;
        const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const date = new Date(y, mo - 1, d);
        // 2026年2月30日 のような存在しない日付は読まない
        if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
        return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
    return null;
};

// 表紙の項目ラベル（空白を除いた文字列）→ 戻り値のキー
const HEADER_FIELD_LABELS = {
    工事場所: 'siteLocation',
    工期: 'workPeriod',
    有効期限: 'validUntil',
    支払条件: 'paymentTerms',
};

/**
 * 明細表より上（表紙部分）の「工事場所」「工期」「有効期限」「支払条件」を読む。
 * 値はラベルと同じ行の右側で最初に空でないセル（右側にある「備考」欄の列より左だけを見る）。
 * 有効期限は日付として読めたときだけ YYYY-MM-DD で返す。
 * @param {Array<Array>} rows sheetToRowsFromA1 の結果
 * @returns {{siteLocation: string|null, workPeriod: string|null, validUntil: string|null, paymentTerms: string|null}}
 */
export const extractHeaderFields = (rows) => {
    const result = { siteLocation: null, workPeriod: null, validUntil: null, paymentTerms: null };
    const list = rows || [];
    const tableStart = list.findIndex(isTableHeaderRow);
    const end = tableStart === -1 ? list.length : tableStart;
    const headerRows = list.slice(0, end).filter(Array.isArray);
    // 「備考」欄は右側に縦長に置かれ、工期などと同じ行に備考の本文が入るため、その列より右は値として読まない
    const notesCols = headerRows
        .map(row => row.findIndex(c => typeof c === 'string' && c.replace(/\s+/g, '') === '備考'))
        .filter(c => c !== -1);
    for (const row of headerRows) {
        row.forEach((cell, col) => {
            if (typeof cell !== 'string') return;
            const key = HEADER_FIELD_LABELS[cell.replace(/\s+/g, '')];
            if (!key || result[key] != null) return;
            const limit = Math.min(row.length, ...notesCols.filter(c => c > col));
            const value = row.slice(col + 1, limit).find(c => !isBlankCell(c));
            if (value == null) return;
            result[key] = key === 'validUntil' ? toIsoDate(value) : String(value).trim();
        });
    }
    return result;
};

/**
 * 明細表より上（表紙部分）の「備考」欄の内容を返す。
 * 「備考」セルの右（同じ行）と、同じ列で下 NOTES_MAX_LINES 行以内（明細表より上）の空でないセルを改行でつなぐ
 * @param {Array<Array>} rows sheetToRowsFromA1 の結果
 * @returns {string|null}
 */
export const extractHeaderNotes = (rows) => {
    const list = rows || [];
    const tableStart = list.findIndex(isTableHeaderRow);
    const end = tableStart === -1 ? list.length : tableStart;
    for (let r = 0; r < end; r++) {
        const row = list[r];
        if (!Array.isArray(row)) continue;
        const col = row.findIndex(c => typeof c === 'string' && c.replace(/\s+/g, '') === '備考');
        if (col === -1) continue;
        const lines = [];
        const right = row.slice(col + 1).find(c => !isBlankCell(c));
        if (right != null) lines.push(String(right));
        // 鏡ありの様式は見出しと本文の間に空行があるため、空のセルは飛ばして読む
        for (let rr = r + 1; rr < Math.min(end, r + 1 + NOTES_MAX_LINES); rr++) {
            const cell = list[rr]?.[col];
            if (!isBlankCell(cell)) lines.push(String(cell));
        }
        const text = lines.join('\n').replace(/\r\n?/g, '\n').trim();
        return text || null;
    }
    return null;
};

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
 * @param {Array<Array>} rows sheetToRowsFromA1 の結果
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
 * @param {Array<Array>} rows 同じシートの sheetToRowsFromA1 の結果
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
                const workbook = xlsx.read(e.target.result, { type: 'binary' });
                resolve(parseEstimateWorkbook(workbook));
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

/**
 * 読み込み済みのワークブックから工事名・顧客名・明細・備考を取り出す（列構成は parseExcelForEstimate を参照）
 * @param {object} workbook xlsx のワークブック
 * @returns {{projectName: string|null, customerName: string|null, items: Array, notes: string|null,
 *   siteLocation: string|null, workPeriod: string|null, validUntil: string|null, paymentTerms: string|null}}
 */
export const parseEstimateWorkbook = (workbook) => {
    let extractedProjectName = null;
    let extractedCustomerName = null;
    let extractedNotes = null;
    let headerFields = extractHeaderFields([]);
    const items = [];

    // シートごとの行配列（1枚目は顧客名の検出と明細の読み取りで共用する）
    const sheetRows = {};
    const getRows = (name) => {
        if (!sheetRows[name]) sheetRows[name] = sheetToRowsFromA1(workbook.Sheets[name]);
        return sheetRows[name];
    };

    // 最初のシートから顧客名を取得（敬称の左 → 従来様式の D13 の順）
    const firstSheetName = workbook.SheetNames[0];
    if (firstSheetName) {
        extractedCustomerName = extractCustomerName(workbook.Sheets[firstSheetName], getRows(firstSheetName));
        extractedNotes = extractHeaderNotes(getRows(firstSheetName));
        headerFields = extractHeaderFields(getRows(firstSheetName));
    }

    // 工種シンボルの自動採番用
    const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let categoryIndex = 0;
    const pushCategory = (categoryName) => {
        items.push({
            item_type: ITEM_TYPE.CATEGORY,
            category_symbol: symbols[categoryIndex] || String(categoryIndex + 1),
            name: categoryName,
            spec: null, quantity: null, unit: null, unit_price: null, amount: null, note: null,
            sort_order: items.length,
        });
        categoryIndex++;
    };

    workbook.SheetNames.forEach(sheetName => {
        const rows = getRows(sheetName);
        let inTable = false; // 明細表のヘッダー行より下か

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
            const name      = row[2];   // C列: 名称
            const spec      = row[24];  // Y列: 仕様
            const quantity  = row[40];  // AO列: 数量
            const unit      = row[43];  // AR列: 単位
            const unitPrice = row[45];  // AT列: 単価
            const amount    = row[49];  // AX列: 金額
            const note      = row[53];  // BB列: 摘要

            const nameText = typeof name === 'string' ? name.trim() : '';
            const specText = isBlankCell(spec) ? '' : String(spec).trim();
            const trimmedName = nameText.replace(/\s+/g, '');

            // 明細表のヘッダー行（「名称」「名　称」）。ここから下を明細表とみなす
            if (trimmedName === '名称') {
                inTable = true;
                return;
            }

            // 名称も仕様も無い行はスキップ
            if (!nameText && !specText) return;

            // 合計・小計・消費税・総計の行はスキップ（システム側で計算し直す）。
            // 諸経費・値引きは自動計算する仕組みが無いので、通常の明細行として取り込む
            if (
                trimmedName.includes('合計') ||
                trimmedName.includes('小計') ||
                trimmedName.includes('総計') ||
                trimmedName.startsWith('消費税')
            ) return;

            // 数量・単位・単価・金額がすべて空の行: 「■」等で始まればグループ（工種）、それ以外はコメント行
            if ([quantity, unit, unitPrice, amount].every(isBlankCell)) {
                if (!inTable) return; // 明細表より上（表紙部分）の文字は明細にしない
                if (GROUP_MARK.test(nameText)) {
                    pushCategory(nameText.replace(GROUP_MARK, '').trim());
                } else {
                    items.push({
                        // DB の item_type 制約に合わせ、コメント行は ITEM + 目印で表す（エディタ読込時に COMMENT へ戻る）
                        item_type: ITEM_TYPE.ITEM,
                        category_symbol: ITEM_SENTINEL.COMMENT,
                        name: [nameText, specText].filter(Boolean).join('　'),
                        spec: null, quantity: null, unit: null, unit_price: null, amount: null, note: null,
                        sort_order: items.length,
                    });
                }
                return;
            }

            // 名称がない行はスキップ
            if (!nameText) return;

            // 工種（カテゴリ）行の判定:
            //   名称があり、数量が数値でない行 → 工種行と見なす
            if (typeof quantity !== 'number') {
                pushCategory(nameText);
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

    return {
        projectName: extractedProjectName,
        customerName: extractedCustomerName,
        items,
        notes: extractedNotes,
        ...headerFields,
    };
};
