import * as xlsx from 'xlsx-js-style';

/**
 * 配置表をExcelに出力する
 * @param {Array} workers - 作業員リスト
 * @param {Array} dateColumns - 日付カラム配列 [{dateStr, day, month, dow, dowLabel}, ...]
 * @param {Object} assignmentLookup - workerId_dateStr → assignments のルックアップ
 * @param {Object} projectMap - projectId → { name, color } のマップ
 * @param {Array} barProjects - バーチャート用プロジェクト配列
 * @param {string} periodLabel - 期間ラベル文字列
 * @param {Function} getBarSpan - プロジェクトのバー範囲を取得する関数
 */
export const exportAssignmentChartToExcel = (
    workers, dateColumns, assignmentLookup, projectMap, barProjects, periodLabel, getBarSpan
) => {
    const wb = xlsx.utils.book_new();
    const totalDays = dateColumns.length;

    // --- シート1: 配置表 ---
    const sheetData = [];

    // 行0: タイトル
    sheetData.push([`配置表: ${periodLabel}`, ...Array(totalDays).fill(null)]);

    // 行1: 空行（セパレーター）
    sheetData.push([]);

    // 行2: ===案件バーチャート ヘッダー===
    const barHeader = ['現場名'];
    dateColumns.forEach(col => {
        barHeader.push(`${col.month}/${col.day}(${col.dowLabel})`);
    });
    sheetData.push(barHeader);

    // 案件バーの行
    const barStartRow = sheetData.length;
    barProjects.forEach(proj => {
        const row = [proj.name];
        const bar = getBarSpan(proj);
        dateColumns.forEach((col, i) => {
            const isInBar = bar && i >= bar.startIdx && i <= bar.endIdx;
            row.push(isInBar ? '■' : '');
        });
        sheetData.push(row);
    });
    if (barProjects.length === 0) {
        sheetData.push(['案件なし', ...Array(totalDays).fill('')]);
    }
    const barEndRow = sheetData.length - 1;

    // セパレーター行
    const sepRow = sheetData.length;
    const sepHeader = ['作業員名'];
    dateColumns.forEach(col => {
        sepHeader.push(`${col.day}`);
    });
    sheetData.push(sepHeader);

    // 作業員配置行
    const workerStartRow = sheetData.length;
    workers.forEach(worker => {
        const row = [worker.name];
        dateColumns.forEach(col => {
            const key = `${worker.id}_${col.dateStr}`;
            const cellAssigns = assignmentLookup[key] || [];
            if (cellAssigns.length > 0) {
                const names = cellAssigns.map(a => {
                    if (a.title) return a.title;
                    const pInfo = projectMap[a.projectId];
                    return pInfo?.name || '';
                });
                row.push(names.join('\n'));
            } else {
                row.push('');
            }
        });
        sheetData.push(row);
    });

    const ws = xlsx.utils.aoa_to_sheet(sheetData);

    // マージ: タイトル行
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(totalDays, 7) } });

    // 列幅
    ws['!cols'] = [{ wch: 16 }];
    for (let i = 0; i < totalDays; i++) {
        ws['!cols'].push({ wch: 10 });
    }

    // スタイル適用
    const borderThin = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
    };

    const range = xlsx.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = xlsx.utils.encode_cell({ r: R, c: C });
            if (!ws[cellRef]) {
                ws[cellRef] = { t: 's', v: '' };
            }
            const cell = ws[cellRef];

            // タイトル行
            if (R === 0) {
                cell.s = {
                    font: { bold: true, sz: 14 },
                    alignment: { vertical: 'center' }
                };
                continue;
            }

            // 空白行
            if (R === 1) continue;

            // 基本スタイル
            cell.s = {
                border: borderThin,
                alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
                font: { sz: 9 }
            };

            // バーチャートヘッダー / セパレーターヘッダー
            if (R === 2 || R === sepRow) {
                const dow = C > 0 ? dateColumns[C - 1]?.dow : null;
                cell.s = {
                    ...cell.s,
                    font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' } },
                    fill: { fgColor: { rgb: '334155' } }
                };
                if (C > 0 && dow === 0) {
                    cell.s.fill = { fgColor: { rgb: 'FEE2E2' } };
                    cell.s.font = { ...cell.s.font, color: { rgb: 'DC2626' } };
                } else if (C > 0 && dow === 6) {
                    cell.s.fill = { fgColor: { rgb: 'DBEAFE' } };
                    cell.s.font = { ...cell.s.font, color: { rgb: '2563EB' } };
                }
            }

            // 名前カラム
            if (C === 0 && R !== 0 && R !== 1) {
                cell.s = {
                    ...cell.s,
                    font: { bold: true, sz: 10 },
                    alignment: { vertical: 'center', horizontal: 'left' }
                };
            }

            // バーチャートのバー部分に色付け
            if (R >= barStartRow && R <= barEndRow && C > 0) {
                const projIdx = R - barStartRow;
                const proj = barProjects[projIdx];
                if (proj && cell.v === '■') {
                    const hexColor = (proj.color || '#94A3B8').replace('#', '');
                    cell.s = {
                        ...cell.s,
                        fill: { fgColor: { rgb: hexColor } },
                        font: { ...cell.s.font, color: { rgb: 'FFFFFF' } }
                    };
                }
            }

            // 作業員配置セル: 色付け
            if (R >= workerStartRow && C > 0) {
                const workerIdx = R - workerStartRow;
                const worker = workers[workerIdx];
                if (worker && cell.v) {
                    const dateCol = dateColumns[C - 1];
                    if (dateCol) {
                        const key = `${worker.id}_${dateCol.dateStr}`;
                        const assigns = assignmentLookup[key] || [];
                        if (assigns.length > 0) {
                            const firstAssign = assigns[0];
                            let color = '#94A3B8';
                            if (firstAssign.projectId) {
                                color = projectMap[firstAssign.projectId]?.color || color;
                            }
                            const hexColor = color.replace('#', '');
                            cell.s = {
                                ...cell.s,
                                fill: { fgColor: { rgb: hexColor } },
                                font: { ...cell.s.font, sz: 8, color: { rgb: 'FFFFFF' }, bold: true }
                            };
                        }
                    }
                }

                // 土日の背景色
                if (!cell.v || cell.v === '') {
                    const dateCol = dateColumns[C - 1];
                    if (dateCol?.dow === 0) {
                        cell.s = { ...cell.s, fill: { fgColor: { rgb: 'FEE2E2' } } };
                    } else if (dateCol?.dow === 6) {
                        cell.s = { ...cell.s, fill: { fgColor: { rgb: 'DBEAFE' } } };
                    }
                }
            }
        }
    }

    xlsx.utils.book_append_sheet(wb, ws, 'AssignmentChart');

    // Blob + aタグ方式でダウンロード（日本語ファイル名対応）
    const today = new Date().toISOString().split('T')[0];
    const fileName = `assignment_chart_${today}.xlsx`;
    const wbout = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
