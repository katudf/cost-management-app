import * as xlsx from 'xlsx-js-style';
import { SCHEDULE_TYPES } from './constants';

// 日付列の幅（文字数）
export const DATE_COL_WCH = 6;
// 日付見出し行（0始まり）。行0: タイトル / 行1: 空行 / 行2: 日付見出し
// 見出し行の高さと、印刷時に2ページ目以降も繰り返す行の範囲はこの行を基準に決める
const BAR_HEADER_ROW = 2;

/**
 * 配置表のワークシートを組み立てる（ダウンロードはしない。テストからも呼ぶ）
 * @param {Array} workers - 作業員リスト
 * @param {Array} dateColumns - 日付カラム配列 [{dateStr, day, month, dow, dowLabel}, ...]
 * @param {Object} assignmentLookup - workerId_dateStr → assignments のルックアップ
 * @param {Object} projectMap - projectId → { name, color } のマップ
 * @param {Array} barProjects - バーチャート用プロジェクト配列
 * @param {string} periodLabel - 期間ラベル文字列
 * @param {Function} getBarSpan - プロジェクトのバー範囲を取得する関数
 * @param {Object} [ninkuLabelByProject] - projectId → 「消化人工/目標人工」の表示文字列（画面の基準日時点）
 * @param {string} [ninkuHeader] - 人工列の見出し（例: '人工（11/12時点）'）
 */
export const buildAssignmentChartSheet = (
    workers, dateColumns, assignmentLookup, projectMap, barProjects, periodLabel, getBarSpan, ninkuLabelByProject = {},
    ninkuHeader = '人工'
) => {
    const totalDays = dateColumns.length;
    // 列0: 現場名・作業員名 / 列1: 人工 / 列2〜: 日付
    const DATE_COL = 2;

    // --- シート1: 配置表 ---
    const sheetData = [];

    // 行0: タイトル
    sheetData.push([`配置表: ${periodLabel}`, ...Array(totalDays + 1).fill(null)]);

    // 行1: 空行（セパレーター）
    sheetData.push([]);

    // 行2: ===案件バーチャート ヘッダー===
    if (sheetData.length !== BAR_HEADER_ROW) {
        throw new Error('日付見出し行の位置が BAR_HEADER_ROW と一致しません');
    }
    const barHeader = ['現場名', ninkuHeader];
    dateColumns.forEach(col => {
        // 日付列が狭いので、日付と曜日の間で改行して2行で見せる
        barHeader.push(`${col.label}\n(${col.dowLabel})`);
    });
    sheetData.push(barHeader);

    // 案件バーの行
    // 現場名は工事短縮名を優先（projectMap の name は短縮名 → 管理現場名の順で決まっている）
    // バーは文字を入れず塗りつぶしだけで表す
    const barStartRow = sheetData.length;
    const barSpans = barProjects.map(proj => getBarSpan(proj));
    barProjects.forEach(proj => {
        const row = [projectMap[proj.id]?.name || proj.name, ninkuLabelByProject[proj.id] || ''];
        sheetData.push([...row, ...Array(totalDays).fill('')]);
    });
    if (barProjects.length === 0) {
        sheetData.push(['案件なし', '', ...Array(totalDays).fill('')]);
    }
    const barEndRow = sheetData.length - 1;

    // セパレーター行
    const sepRow = sheetData.length;
    const sepHeader = ['作業員名', ''];
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
        const rows = Array.from({ length: subRowCount }, (_, s) => [s === 0 ? worker.name : '', '']);

        // 作業員名は人工列まで横に広げる（現場数が多い日の分だけ縦にも結合）
        workerMerges.push({ s: { r: baseRow, c: 0 }, e: { r: baseRow + subRowCount - 1, c: 1 } });

        dayAssigns.forEach((cellAssigns, i) => {
            const C = i + DATE_COL;
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
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(totalDays + 1, 7) } });
    ws['!merges'].push({ s: { r: sepRow, c: 0 }, e: { r: sepRow, c: 1 } });
    ws['!merges'].push(...workerMerges);

    // 列幅
    // 人工列は「12.5/400」程度が収まる幅。見出し「人工（11/12時点）」は折り返して2行で見せる
    ws['!cols'] = [{ wch: 16 }, { wch: 9 }];
    // 日付列は4週間がA3横1枚にほぼ等倍で収まる幅。長い現場名はセル内で折り返す
    for (let i = 0; i < totalDays; i++) {
        ws['!cols'].push({ wch: DATE_COL_WCH });
    }
    ws['!rows'] = [];
    ws['!rows'][BAR_HEADER_ROW] = { hpt: 26 }; // 日付と曜日の2行が収まる高さ

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
            if (R === BAR_HEADER_ROW || R === sepRow) {
                const dow = C >= DATE_COL ? dateColumns[C - DATE_COL]?.dow : null;
                cell.s = {
                    ...cell.s,
                    font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' }, name: 'BIZ UDゴシック' },
                    fill: { fgColor: { rgb: '334155' } }
                };
                if (C >= DATE_COL && dow === 0) {
                    cell.s.fill = { fgColor: { rgb: 'FEE2E2' } };
                    cell.s.font = { ...cell.s.font, color: { rgb: 'DC2626' } };
                } else if (C >= DATE_COL && dow === 6) {
                    cell.s.fill = { fgColor: { rgb: 'DBEAFE' } };
                    cell.s.font = { ...cell.s.font, color: { rgb: '2563EB' } };
                }
            }

            // 名前カラム
            if (C === 0 && R !== 0 && R !== 1) {
                // 見出し行（「現場名」「作業員名」）は濃い背景なので白文字のままにする
                const isHeaderRow = R === BAR_HEADER_ROW || R === sepRow;
                cell.s = {
                    ...cell.s,
                    font: { bold: true, sz: 10, name: 'BIZ UDゴシック', ...(isHeaderRow && { color: { rgb: 'FFFFFF' } }) },
                    alignment: { vertical: 'center', horizontal: 'left' }
                };
            }

            // バーチャートのバー部分に色付け
            if (R >= barStartRow && R <= barEndRow && C >= DATE_COL) {
                const projIdx = R - barStartRow;
                const proj = barProjects[projIdx];
                const bar = barSpans[projIdx];
                const dayIdx = C - DATE_COL;
                if (proj && bar && dayIdx >= bar.startIdx && dayIdx <= bar.endIdx) {
                    const hexColor = (proj.color || '#94A3B8').replace('#', '');
                    cell.s = {
                        ...cell.s,
                        fill: { fgColor: { rgb: hexColor } },
                        font: { ...cell.s.font, color: { rgb: 'FFFFFF' } }
                    };
                }
            }

            // 作業員配置セル: 色付け
            if (R >= workerStartRow && C >= DATE_COL) {
                const hexColor = workerCellColors[`${R}_${C}`];
                if (hexColor) {
                    cell.s = {
                        ...cell.s,
                        fill: { fgColor: { rgb: hexColor } },
                        font: { ...cell.s.font, sz: 8, color: { rgb: '000000' }, bold: true }
                    };
                } else {
                    // 土日の背景色
                    const dateCol = dateColumns[C - DATE_COL];
                    if (dateCol?.dow === 0) {
                        cell.s = { ...cell.s, fill: { fgColor: { rgb: 'FEE2E2' } } };
                    } else if (dateCol?.dow === 6) {
                        cell.s = { ...cell.s, fill: { fgColor: { rgb: 'DBEAFE' } } };
                    }
                }
            }
        }
    }

    return ws;
};

const SHEET_NAME = 'AssignmentChart';
const SHEET_XML_PATH = 'xl/worksheets/sheet1.xml';

const FIT_TO_PAGE = '<pageSetUpPr fitToPage="1"/>';

/**
 * シートXMLの sheetPr に fitToPage="1" を入れる。
 * sheetPr が無ければシート要素の先頭に作る（sheetPr は先頭に置く決まり）。
 * 既にあれば中身を残したまま足す（pageSetUpPr は sheetPr の子要素の最後に置く決まり）。
 */
const addFitToPage = (xml) => {
    // 子要素なしの <sheetPr .../>
    const selfClosing = xml.match(/<sheetPr\b([^>]*?)\/>/);
    if (selfClosing) {
        return xml.replace(selfClosing[0], `<sheetPr${selfClosing[1]}>${FIT_TO_PAGE}</sheetPr>`);
    }
    // 子要素ありの <sheetPr ...>...</sheetPr>
    const withChildren = xml.match(/<sheetPr\b[^>]*>([\s\S]*?)<\/sheetPr>/);
    if (withChildren) {
        const inner = withChildren[1];
        const pageSetUpPr = inner.match(/<pageSetUpPr\b([^>]*?)\/>/);
        let newInner;
        if (!pageSetUpPr) {
            newInner = inner + FIT_TO_PAGE;
        } else if (/\bfitToPage=/.test(pageSetUpPr[1])) {
            newInner = inner.replace(pageSetUpPr[0], pageSetUpPr[0].replace(/\bfitToPage="[^"]*"/, 'fitToPage="1"'));
        } else {
            newInner = inner.replace(pageSetUpPr[0], `<pageSetUpPr${pageSetUpPr[1]} fitToPage="1"/>`);
        }
        return xml.replace(withChildren[0], withChildren[0].replace(inner, newInner));
    }
    return xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr>${FIT_TO_PAGE}</sheetPr>`);
};

/**
 * シートXMLに印刷設定を書き足す: A3横・横幅1ページに縮小（縦は必要なだけページを増やす）
 * xlsx-js-style は用紙サイズ・向き・縮小の設定を書き出せないため、出力したXMLを直接書き換える。
 * paperSize="8" が A3。fitToHeight="0" は「縦は自動」の意味。
 */
export const applyA3LandscapePageSetup = (sheetXml) => {
    // fitToPage を付けないと fitToWidth が効かない。sheetPr が既にあればその中に足す
    let xml = addFitToPage(sheetXml);
    // pageSetup は pageMargins の直後に置く決まり
    const pageSetup = '<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
    if (!/<pageMargins\b[^>]*\/>/.test(xml)) {
        throw new Error('pageMargins の無いシートには印刷設定を書き足せません');
    }
    return xml.replace(/(<pageMargins\b[^>]*\/>)/, `$1${pageSetup}`);
};

/**
 * 配置表のブック（xlsx のバイト列）を作る。印刷設定込み。テストからも呼ぶ
 * （引数は buildAssignmentChartSheet と同じ）
 */
export const buildAssignmentChartWorkbook = (...args) => {
    const ws = buildAssignmentChartSheet(...args);
    // 余白は狭め（インチ）。pageSetup を書き足す位置にもなるので必ず付ける
    ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, SHEET_NAME);
    // 2ページ目以降にもタイトル〜日付見出しの行を繰り返して印刷する（Excelの行番号は1始まり）
    wb.Workbook = { Names: [{ Name: '_xlnm.Print_Titles', Sheet: 0, Ref: `${SHEET_NAME}!$1:$${BAR_HEADER_ROW + 1}` }] };

    const raw = new Uint8Array(xlsx.write(wb, { bookType: 'xlsx', type: 'array' }));
    const zip = xlsx.CFB.read(raw, { type: 'array' });
    const idx = zip.FullPaths.findIndex(p => p.endsWith(`/${SHEET_XML_PATH}`));
    if (idx < 0) throw new Error(`${SHEET_XML_PATH} が見つかりません`);
    const entry = zip.FileIndex[idx];
    // content は環境により Buffer / Uint8Array / 通常の配列のどれかになるので、型付き配列に揃えてから読む
    const sheetXml = new TextDecoder().decode(new Uint8Array(entry.content));
    const newContent = new TextEncoder().encode(applyA3LandscapePageSetup(sheetXml));
    entry.content = newContent;
    entry.size = newContent.length;
    // xlsx.write の既定は無圧縮なので、書き直すときに圧縮してファイルを小さくする
    return xlsx.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
};

/**
 * 配置表をExcelに出力する（引数は buildAssignmentChartSheet と同じ）
 */
export const exportAssignmentChartToExcel = (...args) => {
    const wbout = buildAssignmentChartWorkbook(...args);

    // Blob + aタグ方式でダウンロード（日本語ファイル名対応）
    const today = new Date().toISOString().split('T')[0];
    const fileName = `assignment_chart_${today}.xlsx`;
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
