import * as xlsx from 'xlsx-js-style';
import { SCHEDULE_TYPES } from './constants';

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
        barHeader.push(`${col.label}(${col.dowLabel})`);
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
    // 1日に複数現場がある場合は現場ごとに行を分けて色分けする。
    // 作業員ごとに「期間内で最も現場数が多い日」の数だけ行を確保し、
    // 現場が少ない日は縦方向にセル結合する。
    const workerStartRow = sheetData.length;
    const workerMerges = [];
    const workerCellColors = {}; // `${R}_${C}` → 塗りつぶし色（結合範囲内の全セル分）
    workers.forEach(worker => {
        const dayAssigns = dateColumns.map(col => assignmentLookup[`${worker.id}_${col.dateStr}`] || []);
        const subRowCount = Math.max(1, ...dayAssigns.map(a => a.length));
        const baseRow = sheetData.length;
        const rows = Array.from({ length: subRowCount }, (_, s) => [s === 0 ? worker.name : '']);

        if (subRowCount > 1) {
            workerMerges.push({ s: { r: baseRow, c: 0 }, e: { r: baseRow + subRowCount - 1, c: 0 } });
        }

        dayAssigns.forEach((cellAssigns, i) => {
            const C = i + 1;
            rows.forEach(r => r.push(''));
            const segments = cellAssigns.length > 0 ? cellAssigns : [null];
            segments.forEach((a, k) => {
                // k番目の現場が受け持つ行範囲（行数を現場数で均等割り）
                const from = Math.floor(k * subRowCount / segments.length);
                const to = Math.floor((k + 1) * subRowCount / segments.length) - 1;
                if (a) {
                    const pInfo = a.projectId ? projectMap[a.projectId] : null;
                    const schedType = !a.projectId && a.title ? SCHEDULE_TYPES.find(s => s.title === a.title) : null;
                    rows[from][C] = a.title || pInfo?.name || '';
                    const color = schedType?.color || pInfo?.color || '#94A3B8';
                    for (let s = from; s <= to; s++) {
                        workerCellColors[`${baseRow + s}_${C}`] = color.replace('#', '');
                    }
                }
                if (to > from) {
                    workerMerges.push({ s: { r: baseRow + from, c: C }, e: { r: baseRow + to, c: C } });
                }
            });
        });
        sheetData.push(...rows);
    });

    const ws = xlsx.utils.aoa_to_sheet(sheetData);

    // マージ: タイトル行 + 作業員配置行
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(totalDays, 7) } });
    ws['!merges'].push(...workerMerges);

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
                    font: { bold: true, sz: 14, name: 'BIZ UDゴシック' },
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
                font: { sz: 9, name: 'BIZ UDゴシック' }
            };

            // バーチャートヘッダー / セパレーターヘッダー
            if (R === 2 || R === sepRow) {
                const dow = C > 0 ? dateColumns[C - 1]?.dow : null;
                cell.s = {
                    ...cell.s,
                    font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' }, name: 'BIZ UDゴシック' },
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
                    font: { bold: true, sz: 10, name: 'BIZ UDゴシック' },
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
                const hexColor = workerCellColors[`${R}_${C}`];
                if (hexColor) {
                    cell.s = {
                        ...cell.s,
                        fill: { fgColor: { rgb: hexColor } },
                        font: { ...cell.s.font, sz: 8, color: { rgb: '000000' }, bold: true }
                    };
                } else {
                    // 土日の背景色
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
