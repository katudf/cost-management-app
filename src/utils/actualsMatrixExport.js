// 実績入力の人工表（月ごと）をExcelに出力する
import * as xlsx from 'xlsx-js-style';
import { addFitToPage } from './assignmentChartExport';
import { buildActualsMatrixReport, formatPeriodLabel } from './actualsMatrixReport';

export const NINKU_NOTE = '7.5時間＝1人工（人工は小数第1位に丸めて表示）';

const BORDER = {
    top: { style: 'thin', color: { rgb: '94A3B8' } },
    bottom: { style: 'thin', color: { rgb: '94A3B8' } },
    left: { style: 'thin', color: { rgb: '94A3B8' } },
    right: { style: 'thin', color: { rgb: '94A3B8' } },
};
const FILL_HEAD = { fgColor: { rgb: 'F1F5F9' } };
const FILL_SUN = { fgColor: { rgb: 'FEE2E2' } };
const FILL_SAT = { fgColor: { rgb: 'DBEAFE' } };
const FILL_SUM = { fgColor: { rgb: 'DBEAFE' } };

const cellStyle = (extra = {}) => ({
    font: { name: 'Meiryo', sz: 10, ...(extra.font || {}) },
    alignment: { vertical: 'center', ...(extra.alignment || {}) },
    border: BORDER,
    ...(extra.fill ? { fill: extra.fill } : {}),
});

// Excelのシート名は31文字以内・一部記号不可。月ラベル（例 2026年3月）は問題なし
const sheetNameOf = (month) => month.label;

/** 1か月分のワークシート。ダウンロードはしない（テストからも呼ぶ） */
export const buildActualsMatrixSheet = (month, { projectName, periodLabel, exportedAt }) => {
    const { dates, rows, otherRow, total } = month;
    // 列0: 作業員名 / 列1〜: 日付 / 最後の2列: 月合計・累計
    const dayCount = dates.length;
    const monthCol = 1 + dayCount;
    const cumCol = monthCol + 1;
    const lastCol = cumCol;

    const data = [];
    data.push([`実績入力（人工表）: ${month.label}`]);
    data.push([`工事名: ${projectName || ''}`]);
    data.push([`出力期間: ${periodLabel}　出力日: ${exportedAt}　※${NINKU_NOTE}`]);
    const HEADER_ROW = data.length;
    data.push([
        '作業員名',
        ...dates.map(d => `${d.day}\n(${d.dowLabel})`),
        '月合計',
        '累計',
    ]);

    const bodyStart = data.length;
    rows.forEach(r => {
        data.push([r.name, ...r.cells.map(v => (v === null ? '' : v)), r.monthTotal ?? '', r.cumulative]);
    });
    if (otherRow) {
        data.push([otherRow.name, ...Array(dayCount).fill(''), '', otherRow.cumulative]);
    }
    const totalRow = data.length;
    data.push([
        '合計',
        ...total.cells.map(v => (v === null ? '' : v)),
        total.monthTotal,
        total.cumulative,
    ]);

    const ws = xlsx.utils.aoa_to_sheet(data);

    ws['!cols'] = [
        { wch: 24 },
        ...dates.map(() => ({ wch: 5.5 })),
        { wch: 9 },
        { wch: 9 },
    ];
    ws['!rows'] = [{ hpt: 24 }, { hpt: 16 }, { hpt: 16 }, { hpt: 30 }];
    ws['!merges'] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: lastCol } }));

    const addr = (r, c) => xlsx.utils.encode_cell({ r, c });
    const setCell = (r, c, style) => {
        const ref = addr(r, c);
        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
        ws[ref].s = style;
    };
    const NUM_FMT = '0.0';

    ws[addr(0, 0)].s = { font: { name: 'Meiryo', sz: 14, bold: true }, alignment: { vertical: 'center' } };
    ws[addr(1, 0)].s = { font: { name: 'Meiryo', sz: 10 } };
    ws[addr(2, 0)].s = { font: { name: 'Meiryo', sz: 9, color: { rgb: '64748B' } } };

    // 見出し行
    for (let c = 0; c <= lastCol; c++) {
        const d = c >= 1 && c <= dayCount ? dates[c - 1] : null;
        const fill = d ? ((d.isSunday || d.isHoliday) ? FILL_SUN : (d.isSaturday ? FILL_SAT : FILL_HEAD)) : (c > dayCount ? FILL_SUM : FILL_HEAD);
        setCell(HEADER_ROW, c, cellStyle({
            font: { bold: true, sz: 9, color: { rgb: d && (d.isSunday || d.isHoliday) ? 'DC2626' : (d && d.isSaturday ? '2563EB' : '334155') } },
            alignment: { horizontal: 'center', wrapText: true },
            fill,
        }));
    }

    // 本体・その他・合計
    for (let r = bodyStart; r <= totalRow; r++) {
        const isTotal = r === totalRow;
        for (let c = 0; c <= lastCol; c++) {
            const isSummaryCol = c > dayCount;
            const d = c >= 1 && c <= dayCount ? dates[c - 1] : null;
            let fill;
            if (isTotal || isSummaryCol) fill = FILL_SUM;
            else if (d && (d.isSunday || d.isHoliday)) fill = { fgColor: { rgb: 'FEF2F2' } };
            else if (d && d.isSaturday) fill = { fgColor: { rgb: 'EFF6FF' } };
            setCell(r, c, cellStyle({
                font: { bold: isTotal || isSummaryCol || c === 0 },
                alignment: { horizontal: c === 0 ? 'left' : 'center' },
                fill,
            }));
            if (c > 0 && typeof ws[addr(r, c)].v === 'number') ws[addr(r, c)].z = NUM_FMT;
        }
    }
    return ws;
};

const SHEET_XML = (i) => `xl/worksheets/sheet${i + 1}.xml`;
// A4横（paperSize 9）・横幅1ページに縮小
const A4_LANDSCAPE_SETUP = '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';

export const applyA4LandscapePageSetup = (sheetXml) => {
    const xml = addFitToPage(sheetXml);
    if (!/<pageMargins\b[^>]*\/>/.test(xml)) {
        throw new Error('pageMargins の無いシートには印刷設定を書き足せません');
    }
    return xml.replace(/(<pageMargins\b[^>]*\/>)/, `$1${A4_LANDSCAPE_SETUP}`);
};

/** 期間分のブック（xlsx のバイト列）を作る。1か月＝1シート */
export const buildActualsMatrixWorkbook = (params) => {
    const { projectName, startMonth, endMonth, exportedAt } = params;
    const { months } = buildActualsMatrixReport(params);
    const periodLabel = formatPeriodLabel(startMonth, endMonth);

    const wb = xlsx.utils.book_new();
    const names = [];
    months.forEach(month => {
        const ws = buildActualsMatrixSheet(month, { projectName, periodLabel, exportedAt });
        ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
        xlsx.utils.book_append_sheet(wb, ws, sheetNameOf(month));
        names.push(sheetNameOf(month));
    });
    // 2ページ目以降にも見出し行を繰り返す（作業員が多くて縦に改ページするとき用）
    wb.Workbook = {
        Names: names.map((n, i) => ({ Name: '_xlnm.Print_Titles', Sheet: i, Ref: `'${n}'!$1:$4` })),
    };

    const raw = new Uint8Array(xlsx.write(wb, { bookType: 'xlsx', type: 'array' }));
    const zip = xlsx.CFB.read(raw, { type: 'array' });
    months.forEach((_, i) => {
        const idx = zip.FullPaths.findIndex(p => p.endsWith(`/${SHEET_XML(i)}`));
        if (idx < 0) throw new Error(`${SHEET_XML(i)} が見つかりません`);
        const entry = zip.FileIndex[idx];
        const sheetXml = new TextDecoder().decode(new Uint8Array(entry.content));
        const content = new TextEncoder().encode(applyA4LandscapePageSetup(sheetXml));
        entry.content = content;
        entry.size = content.length;
    });
    return xlsx.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
};

/** ファイル名に使えない文字を取り除く */
export const safeFileName = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

export const actualsMatrixFileName = (projectName, startMonth, endMonth, ext) => {
    const [from, to] = startMonth <= endMonth ? [startMonth, endMonth] : [endMonth, startMonth];
    const period = from === to ? from : `${from}_${to}`;
    return `実績入力_${safeFileName(projectName)}_${period}.${ext}`;
};

export const exportActualsMatrixToExcel = (params) => {
    const wbout = buildActualsMatrixWorkbook(params);
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = actualsMatrixFileName(params.projectName, params.startMonth, params.endMonth, 'xlsx');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
