import * as xlsx from 'xlsx-js-style';

/**
 * Excelファイルをインポート用にパースする関数
 * @param {File} file インポートするExcelファイル
 * @param {number} hourlyWage 時給（予定時間の計算に使用）
 * @returns {Promise<{projectName: string, masterData: Array}>} パース結果
 */
export const parseExcelForImport = (file, hourlyWage) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target.result;
                const workbook = xlsx.read(data, { type: 'binary' });

                let extractedProjectName = null;
                let extractedCustomerName = null;
                const newMasterData = [];

                // 最初のシートから顧客名を取得 (D13)
                const firstSheetName = workbook.SheetNames[0];
                if (firstSheetName) {
                    const firstSheet = workbook.Sheets[firstSheetName];
                    const customerCell = firstSheet['D13'];
                    if (customerCell && customerCell.v) {
                        extractedCustomerName = String(customerCell.v).trim();
                    }
                }

                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

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

                        // 各項目の抽出
                        const name = row[2];      // C列
                        const spec = row[24];     // Y列
                        const quantity = row[40]; // AO列
                        const unit = row[43];     // AR列
                        const amount = row[49];   // AX列

                        if (
                            name && typeof name === 'string' &&
                            !name.includes('合　計') && !name.includes('小　計') &&
                            !name.includes('諸経費') && !name.includes('値引') &&
                            typeof quantity === 'number'
                        ) {
                            const taskName = `${name}${spec ? ` [${spec}]` : ''} (${quantity}${unit || ''})`;
                            let targetHours = 0;
                            let estimatedAmount = 0;
                            if (typeof amount === 'number' && amount > 0) {
                                estimatedAmount = amount;
                                targetHours = Math.round(amount / hourlyWage);
                            }

                            newMasterData.push({ task: taskName, target: targetHours, estimatedAmount: estimatedAmount });
                        }
                    });
                });

                resolve({ projectName: extractedProjectName, customerName: extractedCustomerName, masterData: newMasterData });
            } catch (error) {
                console.error('Excelパースエラー:', error);
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

                // 最初のシートから顧客名を取得 (D13)
                const firstSheetName = workbook.SheetNames[0];
                if (firstSheetName) {
                    const firstSheet = workbook.Sheets[firstSheetName];
                    const customerCell = firstSheet['D13'];
                    if (customerCell && customerCell.v) {
                        extractedCustomerName = String(customerCell.v).trim();
                    }
                }

                // 工種シンボルの自動採番用
                const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                let categoryIndex = 0;

                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

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
                                item_type: 'category',
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
                            item_type: 'item',
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
