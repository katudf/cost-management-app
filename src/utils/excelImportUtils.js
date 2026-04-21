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
