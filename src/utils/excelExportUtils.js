import * as xlsx from 'xlsx-js-style';
import { calculateNinku, formatTimeDisplay } from './workTimeUtils';
import layoutData from '../layout_react.json';
import * as fflate from 'fflate';

/**
 * A4横向き・1ページに収まる印刷設定を適用する共通ヘルパー
 */
const applyA4LandscapePrintSettings = (ws) => {
    // 用紙: A4 (paperSize=9), 横向き, 1ページ幅に収める
    ws['!pageSetup'] = {
        paperSize: 9,            // A4
        orientation: 'landscape', // 横向き
        fitToWidth: 1,           // 幅を1ページに収める
        fitToHeight: 0,          // 高さは制限なし（複数ページ可）
        scale: 0,                // fitToPage使用時はscale=0
    };
    // 余白 (インチ単位、狭めに設定)
    ws['!margins'] = {
        left: 0.4,
        right: 0.4,
        top: 0.4,
        bottom: 0.4,
        header: 0.2,
        footer: 0.2,
    };
};

/**
 * 現場サマリーをExcelに出力する
 */
export const exportToExcel = (activeProject, summaryData) => {
    if (!activeProject || summaryData.items.length === 0) return;

    // 現場名ヘッダー行を作成
    const siteNameRow = [`現場名: ${activeProject.siteName || '無題'}`];

    // Excel書き込みデータ作成（サマリー用）
    const ws1Data = [
        siteNameRow,
        ["項目", "予定時間", "実績時間", "進捗率(%)", "時間差異", "予測損益", "状況"]
    ];
    summaryData.items.forEach(item => {
        ws1Data.push([
            item.task,
            item.target,
            item.actual,
            item.progress,
            item.variance.toFixed(1),
            item.predictedProfitLoss.toLocaleString() + '円',
            item.status === 'danger' ? '要注意' : item.status === 'warning' ? '警告' : '順調'
        ]);
    });
    // 合計行（サマリー）
    ws1Data.push([
        "【合計】",
        summaryData.totalTarget,
        summaryData.totalActual,
        "-",
        "-",
        summaryData.totalPredictedProfitLoss.toLocaleString() + '円',
        "-"
    ]);

    // Excel書き込みデータ作成（詳細用）
    const ws2Data = [
        siteNameRow,
        ["作業項目", "作業内容", "作業員", "開始", "終了", "実働時間", "時間外", "日付"]
    ];
    activeProject.records.forEach(r => {
        const taskName = activeProject.masterData.find(m => m.id === r.taskId)?.task || '不明';

        ws2Data.push([
            taskName,
            r.memo || '',
            r.worker || '未設定',
            r.start_time ? formatTimeDisplay(r.start_time) : '',
            r.end_time ? formatTimeDisplay(r.end_time) : '',
            r.hours || 0,
            r.overtime_hours || 0,
            r.date || '',
        ]);
    });

    const wb = xlsx.utils.book_new();
    const ws1 = xlsx.utils.aoa_to_sheet(ws1Data);
    const ws2 = xlsx.utils.aoa_to_sheet(ws2Data);

    // スタイル設定
    const borderStyle = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" }
    };
    const headerStyle = {
        font: { bold: true, name: "BIZ UDゴシック" },
        fill: { fgColor: { rgb: "EFEFEF" } },
        border: borderStyle
    };
    const dataStyle = {
        font: { name: "BIZ UDゴシック" },
        border: borderStyle
    };

    const applyStyleToSheet = (ws, columnsCount) => {
        if (!ws['!ref']) return;

        // 現場名のセル（A1）をマージする
        if (!ws['!merges']) ws['!merges'] = [];
        ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: columnsCount - 1 } });

        const range = xlsx.utils.decode_range(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = xlsx.utils.encode_cell({ r: R, c: C });
                if (!ws[cellRef]) continue;
                if (R === 0) {
                    ws[cellRef].s = {
                        font: { bold: true, sz: 12, name: "BIZ UDゴシック" },
                        alignment: { vertical: "center", horizontal: "left" }
                    };
                } else if (R === 1) {
                    ws[cellRef].s = headerStyle;
                } else {
                    ws[cellRef].s = Object.assign({}, ws[cellRef].s || {}, dataStyle);
                }
            }
        }
    };

    applyStyleToSheet(ws1, 7);
    applyStyleToSheet(ws2, 8);

    // 作業員別の集計データ作成（季節別の定時労働時間で人工数を算出）
    const workerHours = {};
    activeProject.records.forEach(r => {
        const workerName = r.worker || '未設定';
        if (!workerHours[workerName]) {
            workerHours[workerName] = { hours: 0, overtime: 0 };
        }
        workerHours[workerName].hours += Number(r.hours || 0);
        workerHours[workerName].overtime += Number(r.overtime_hours || 0);
    });

    const ws3Data = [
        siteNameRow,
        ["作業員名", "延べ実労働時間 (h)", "うち時間外 (h)", "延べ人工 (7.5h/人工)"]
    ];

    let totalWorkerHours = 0;
    let totalWorkerOvertime = 0;
    const sortedWorkers = Object.keys(workerHours).sort((a, b) => workerHours[b].hours - workerHours[a].hours);

    sortedWorkers.forEach(worker => {
        const { hours, overtime } = workerHours[worker];
        totalWorkerHours += hours;
        totalWorkerOvertime += overtime;
        // 人工数は季節のデフォルト（7.5h）で算出
        const ninku = parseFloat((hours / 7.5).toFixed(2));
        ws3Data.push([worker, parseFloat(hours.toFixed(1)), parseFloat(overtime.toFixed(1)), ninku]);
    });

    ws3Data.push([
        "【合計】",
        parseFloat(totalWorkerHours.toFixed(1)),
        parseFloat(totalWorkerOvertime.toFixed(1)),
        parseFloat((totalWorkerHours / 7.5).toFixed(2))
    ]);

    const ws3 = xlsx.utils.aoa_to_sheet(ws3Data);
    applyStyleToSheet(ws3, 4);

    // 列幅の簡易調整
    ws1['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 10 }];
    ws2['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 15 }];
    ws3['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 22 }];

    // A4横向き印刷設定
    applyA4LandscapePrintSettings(ws1);
    applyA4LandscapePrintSettings(ws2);
    applyA4LandscapePrintSettings(ws3);

    xlsx.utils.book_append_sheet(wb, ws1, "現場サマリー");
    xlsx.utils.book_append_sheet(wb, ws2, "作業項目別詳細");
    xlsx.utils.book_append_sheet(wb, ws3, "作業員別集計");

    const today = new Date().toISOString().split('T')[0];
    const raw = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
    const rawUint8 = new Uint8Array(raw);
    const ps = {
        paperSize: 9, // A4
        orientation: 'landscape' // 横向き
    };
    injectPageSetupAndSave(rawUint8, `${activeProject.siteName}_工数管理レポート_${today}.xlsx`, ps);
};


/**
 * layout_react.json のボーダー文字列を xlsx-js-style のボーダーオブジェクトに変換する
 * 例: "2px solid #000" → { style: "medium", color: { rgb: "000000" } }
 *     "1px dotted #000" → { style: "dotted", color: { rgb: "000000" } }
 */
const parseBorder = (borderStr) => {
    if (!borderStr) return undefined;
    const parts = borderStr.trim().split(/\s+/);
    if (parts.length < 3) return { style: "thin" };
    const widthPx = parseFloat(parts[0]);
    const lineStyle = parts[1]; // solid, dotted, dashed
    const colorHex = parts[2].replace('#', '');

    let xlStyle = 'thin';
    if (lineStyle === 'dotted') xlStyle = 'dotted';
    else if (lineStyle === 'dashed') xlStyle = 'dashed';
    else if (widthPx >= 2) xlStyle = 'medium';
    else xlStyle = 'thin';

    return { style: xlStyle, color: { rgb: colorHex.padStart(6, '0').toUpperCase() } };
};

/**
 * layout_react.json のセル定義から xlsx-js-style のスタイルオブジェクトを生成する
 */
const buildCellStyle = (cellDef) => {
    const style = {};

    // Border
    const border = {};
    if (cellDef.border) {
        if (cellDef.border.top) border.top = parseBorder(cellDef.border.top);
        if (cellDef.border.bottom) border.bottom = parseBorder(cellDef.border.bottom);
        if (cellDef.border.left) border.left = parseBorder(cellDef.border.left);
        if (cellDef.border.right) border.right = parseBorder(cellDef.border.right);
        if (cellDef.border.diagonal) {
            border.diagonal = {
                style: cellDef.border.diagonal.style || "thin",
                color: { rgb: (cellDef.border.diagonal.color || "#000000").replace('#', '').padStart(6, '0').toUpperCase() }
            };
            if (cellDef.border.diagonalUp != null) border.diagonalUp = !!cellDef.border.diagonalUp;
            if (cellDef.border.diagonalDown != null) border.diagonalDown = !!cellDef.border.diagonalDown;
        }
    }
    if (Object.keys(border).length > 0) style.border = border;

    // Font
    const font = {};
    if (cellDef.font) {
        if (cellDef.font.bold) font.bold = true;
        if (cellDef.font.size) font.sz = Math.round(cellDef.font.size);
        if (cellDef.font.color) font.color = { rgb: cellDef.font.color.replace('#', '').padStart(6, '0').toUpperCase() };
    }
    font.name = "BIZ UDゴシック";
    style.font = font;

    // Alignment
    const alignment = {};
    if (cellDef.align) {
        if (cellDef.align.h === 'center') alignment.horizontal = 'center';
        else if (cellDef.align.h === 'right') alignment.horizontal = 'right';
        else alignment.horizontal = 'left';

        if (cellDef.align.v === 'center') alignment.vertical = 'center';
        else if (cellDef.align.v === 'top') alignment.vertical = 'top';
        else alignment.vertical = 'bottom';

        if (cellDef.align.wrap) alignment.wrapText = true;
        if (cellDef.align.textRotation != null) alignment.textRotation = cellDef.align.textRotation;
    }
    if (Object.keys(alignment).length > 0) style.alignment = alignment;

    // Background color
    if (cellDef.bgColor) {
        style.fill = { fgColor: { rgb: cellDef.bgColor.replace('#', '').padStart(6, '0').toUpperCase() } };
    }

    return style;
};

/**
 * 列番号（1始まり）をアルファベットに変換
 */
const colNumToLetter = (n) => {
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
};

/**
 * 列アルファベットを列番号（1始まり）に変換
 */
const letterToColNum = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        n = n * 26 + (s.charCodeAt(i) - 64);
    }
    return n;
};

/**
 * xlsx-js-style が未対応の pageSetup（向き・用紙・fitToPage）を
 * fflate で XLSX ZIP の sheet1.xml に直接注入してファイル保存する
 */
function injectPageSetupAndSave(uint8arr, fileName, ps) {
    // ZIP を解凍
    const unzipped = fflate.unzipSync(uint8arr);

    // xl/worksheets/sheet*.xml をすべて取得して処理
    const sheetKeys = Object.keys(unzipped).filter(k => k.match(/xl\/worksheets\/sheet\d+\.xml/));
    if (sheetKeys.length === 0) { console.error('sheet xml not found'); return; }

    sheetKeys.forEach(sheetKey => {
        let xml = new TextDecoder().decode(unzipped[sheetKey]);

        // ① <sheetPr> に fitToPage="1" を追加
        if (xml.includes('<sheetPr')) {
            if (!xml.includes('pageSetUpPr')) {
                // 自己終了タグ <sheetPr ... /> の場合
                if (xml.match(/<sheetPr([^>]*)\/>/)) {
                    xml = xml.replace(/<sheetPr([^>]*)\/>/, (m, attrs) => {
                        return `<sheetPr${attrs}><pageSetUpPr fitToPage="1"/></sheetPr>`;
                    });
                } else {
                    // 通常の開始タグ <sheetPr ...> の場合
                    xml = xml.replace(/<sheetPr([^>]*)>/, (m, attrs) => {
                        return `<sheetPr${attrs}><pageSetUpPr fitToPage="1"/>`;
                    });
                }
            }
        } else {
            // sheetPr 要素自体がない場合は <dimension> の前に挿入
            xml = xml.replace('<dimension', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
        }

        // ② <pageSetup> を挿入
        const pageSetupXml = `<pageSetup paperSize="${ps.paperSize}" orientation="${ps.orientation}" fitToWidth="1" fitToHeight="1" r:id="rId1"/>`;
        if (!xml.includes('<pageSetup')) {
            if (xml.includes('</pageMargins>')) {
                xml = xml.replace('</pageMargins>', `</pageMargins>${pageSetupXml}`);
            } else if (xml.includes('<ignoredErrors')) {
                xml = xml.replace('<ignoredErrors', `${pageSetupXml}<ignoredErrors`);
            } else {
                xml = xml.replace('</worksheet>', `${pageSetupXml}</worksheet>`);
            }
        }

        // 修正した XML を UTF-8 バイト列に戻して ZIP に上書き
        unzipped[sheetKey] = fflate.strToU8(xml);
    });

    // 再圧縮
    const zipped = fflate.zipSync(unzipped);

    // ブラウザでダウンロード
    const blob = new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 就労日報の単一ワークシートを生成する内部ヘルパー
 */
const createWorkerReportSheet = (workerName, days, recordsData, projects, subcontractorsData) => {
    const { rows: ROWS, cells: templateCells, mergedCells, colWidths, rowHeights } = layoutData;
    const COLS_COUNT = 17; // A〜Q

    // 7曜日の日付列 D, F, H, J, L, N, P → 1-indexed: 4, 6, 8, 10, 12, 14, 16
    const dayMainCols = [4, 6, 8, 10, 12, 14, 16];
    const daySubCols  = [5, 7, 9, 11, 13, 15, 17];

    // ---- データの前処理 ----
    const dateProjectMap = {};
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const projGroups = {};
        dayRecords.forEach(r => {
            const pid = r.ProjectTasks?.projectId || r.project_id;
            if (!projGroups[pid]) {
                const proj = projects.find(p => p.id === pid);
                projGroups[pid] = {
                    siteName: proj?.siteName || proj?.name || '不明な現場',
                    items: [],
                    sumHours: 0,
                    sumOvertime: 0,
                    timeSlots: [],
                };
            }
            const taskName = r.ProjectTasks?.name || '不明な作業';
            const displayName = r.note ? `${taskName}(${r.note})` : taskName;
            projGroups[pid].items.push(displayName);
            projGroups[pid].sumHours += Number(r.hours || 0);
            projGroups[pid].sumOvertime += Number(r.overtime_hours || 0);
            if (r.start_time && r.end_time) {
                projGroups[pid].timeSlots.push({
                    start: formatTimeDisplay(r.start_time),
                    end: formatTimeDisplay(r.end_time),
                });
            }
        });
        dateProjectMap[d] = Object.values(projGroups);
    });

    // ---- グリッドをテンプレートの静的値で初期化 ----
    // フォーミュラ(=...)はスキップして空文字にする
    const grid = [];
    for (let R = 0; R < ROWS; R++) {
        const row = [];
        for (let C = 0; C < COLS_COUNT; C++) {
            const key = `${colNumToLetter(C + 1)}${R + 1}`;
            const cellDef = templateCells[key];
            let val = '';
            if (cellDef?.value != null) {
                const v = String(cellDef.value);
                val = v.startsWith('=') ? '' : cellDef.value;
            }
            row.push(val);
        }
        grid.push(row);
    }

    // ---- 動的データでセルを上書き ----
    const startYear = new Date(days[0]).getFullYear();
    const reiwaYear = startYear - 2018;
    grid[0][0] = `就　労　日　報 (R${reiwaYear})`;

    // Row 1: 作業者名 (M1 = index[0][12])
    grid[0][12] = workerName;

    // Row 2: 日付
    days.forEach((d, i) => {
        const parts = d.split('-');
        grid[1][dayMainCols[i] - 1] = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
        grid[1][daySubCols[i] - 1] = '';
    });

    // Row 3: 曜日（テンプレートの値をそのまま使用するが、実際の曜日に合わせて上書き）
    const DOW_LABELS = ['(日)', '(月)', '(火)', '(水)', '(木)', '(金)', '(土)'];
    days.forEach((d, i) => {
        const dow = new Date(d).getDay();
        grid[2][dayMainCols[i] - 1] = DOW_LABELS[dow];
        grid[2][daySubCols[i] - 1] = '';
    });

    // Rows 4-12: 現場①②③ブロック（データ列をクリア後、実績で埋める）
    for (let g = 0; g < 3; g++) {
        const baseRow = 3 + g * 3; // 0-indexed
        // データ列をクリア
        for (let di = 0; di < 7; di++) {
            const mc = dayMainCols[di] - 1;
            const sc = daySubCols[di] - 1;
            grid[baseRow][mc] = '';     grid[baseRow][sc] = '';
            grid[baseRow + 1][mc] = ''; grid[baseRow + 1][sc] = '';
            grid[baseRow + 2][mc] = ''; grid[baseRow + 2][sc] = '';
        }
        // 実績データを埋める
        days.forEach((d, i) => {
            const group = dateProjectMap[d][g];
            const mc = dayMainCols[i] - 1;
            if (!group) return;

            grid[baseRow][mc] = group.siteName;

            if (group.timeSlots.length > 0) {
                const slotTexts = group.timeSlots.map(s => `${s.start}～${s.end}`);
                grid[baseRow + 1][mc] = [...new Set(slotTexts)].join('\n');
            }

            const uniqueItems = [...new Set(group.items)];
            grid[baseRow + 2][mc] = uniqueItems.join('\n');
        });
    }

    // Rows 13-15: 協力会社
    for (let c = 0; c < 3; c++) {
        const row = 12 + c;
        days.forEach((d, i) => {
            const daySubs = (subcontractorsData || []).filter(s => s.date === d);
            const sub = daySubs[c];
            grid[row][dayMainCols[i] - 1] = sub?.company_name || '';
            grid[row][daySubCols[i] - 1]  = sub?.worker_count ? `${sub.worker_count}` : '';
        });
    }

    // Rows 16-18: 使用材料（データなし、テンプレートの空セルのまま）

    // Row 19: 作業手当
    days.forEach((d, i) => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const dayOt = dayRecords.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0);
        grid[18][dayMainCols[i] - 1] = dayOt > 0 ? dayOt.toFixed(1) : '';
        grid[18][daySubCols[i] - 1]  = '';
    });

    // Row 20: 備考（実働時間 + 人工数サマリー）
    days.forEach((d, i) => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const dayTotal = dayRecords.reduce((sum, r) => sum + Number(r.hours || 0), 0);
        grid[19][dayMainCols[i] - 1] = dayTotal > 0
            ? `${dayTotal.toFixed(1)}h (${calculateNinku(dayTotal, d)}人工)` : '';
        grid[19][daySubCols[i] - 1]  = '';
    });

    // ---- ワークシートを構築 ----
    const ws = xlsx.utils.aoa_to_sheet(grid);

    // ---- layout_react.json のスタイルを全セルに適用 ----
    for (const [key, cellDef] of Object.entries(templateCells)) {
        if (!cellDef) continue;
        const match = key.match(/^([A-Z]+)(\d+)$/);
        if (!match) continue;
        const colNum = letterToColNum(match[1]);
        const rowNum = parseInt(match[2]);
        if (rowNum > ROWS || colNum > COLS_COUNT) continue;

        const cellRef = xlsx.utils.encode_cell({ r: rowNum - 1, c: colNum - 1 });
        if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
        ws[cellRef].s = buildCellStyle(cellDef);
    }

    // ---- セル結合: layout_react.json の mergedCells をそのまま使用 ----
    ws['!merges'] = mergedCells.map(m => ({
        s: { r: m.minRow - 1, c: m.minCol - 1 },
        e: { r: m.maxRow - 1, c: Math.min(m.maxCol, COLS_COUNT) - 1 },
    }));

    // ---- 列幅: wpx でピクセル値を直接指定（wch 近似変換より正確） ----
    const COL_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q'];
    ws['!cols'] = COL_LETTERS.map(l => ({
        wpx: colWidths[l] || 64,
    }));

    // ---- 行高さ: hpx でピクセル値を直接指定（pt 近似変換より正確） ----
    ws['!rows'] = [];
    for (let r = 1; r <= ROWS; r++) {
        const hpx = rowHeights[String(r)] || rowHeights[r] || 20;
        ws['!rows'].push({ hpx });
    }

    // ---- 余白（xlsx-js-style が対応している唯一の印刷設定） ----
    const ps = layoutData.pageSetup;
    ws['!margins'] = {
        left:   ps.margins.left_mm   / 25.4,
        right:  ps.margins.right_mm  / 25.4,
        top:    ps.margins.top_mm    / 25.4,
        bottom: ps.margins.bottom_mm / 25.4,
        header: ps.margins.header_mm / 25.4,
        footer: ps.margins.footer_mm / 25.4,
    };

    return { ws, ps };
};

/**
 * 就労日報のExcel出力を生成
 * layout_react.json のレイアウト（罫線・フォント・結合・サイズ）を忠実に再現する
 */
export const generateWorkerReportExcel = (workerName, weekPrefix, days, recordsData, projects, subcontractorsData) => {
    const { ws, ps } = createWorkerReportSheet(workerName, days, recordsData, projects, subcontractorsData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '就労日報');

    // ---- xlsx-js-style は pageSetup(向き・用紙・fitToPage)を未サポートのため
    //      fflate で XLSX ZIP を解凍し sheet*.xml に直接 XML を注入する ----
    const raw = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
    injectPageSetupAndSave(new Uint8Array(raw), `${workerName}_就労日報_${weekPrefix}.xlsx`, ps);
};

/**
 * 複数名分の就労日報をまとめて1つのブック（各作業員名シート）で出力する
 */
export const generateMultipleWorkersReportExcel = (workersDataList, weekPrefix) => {
    if (!workersDataList || workersDataList.length === 0) return;

    const wb = xlsx.utils.book_new();
    let globalPs = null;

    workersDataList.forEach(data => {
        const { workerName, days, recordsData, projects, subcontractorsData } = data;
        const { ws, ps } = createWorkerReportSheet(workerName, days, recordsData, projects, subcontractorsData);
        // シート名は作業員名にする（Excelのシート名制限31字に収まるようにスライス）
        const sheetName = workerName.slice(0, 31);
        xlsx.utils.book_append_sheet(wb, ws, sheetName);
        if (!globalPs) globalPs = ps;
    });

    const raw = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
    
    // ファイル名（単一の場合は作業員名、複数の場合は「N名分_就労日報」とする）
    let fileName = '';
    if (workersDataList.length === 1) {
        fileName = `${workersDataList[0].workerName}_就労日報_${weekPrefix}.xlsx`;
    } else {
        fileName = `${workersDataList.length}名分_就労日報_${weekPrefix}.xlsx`;
    }

    injectPageSetupAndSave(new Uint8Array(raw), fileName, globalPs);
};

