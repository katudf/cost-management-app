import { calculateNinku, formatTimeDisplay } from './workTimeUtils';

/**
 * 共通のCSSスタイル定義
 */
const COMMON_CSS_STYLE = `
    @page {
        size: A4 landscape;
        margin-top: 9mm;
        margin-bottom: 5mm;
        margin-left: 7mm;
        margin-right: 5mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: "BIZ UDゴシック", "Yu Gothic", "Meiryo", "Hiragino Kaku Gothic Pro", sans-serif;
        font-size: 8.5px;
        color: #000;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    /* ===== コンテンツ用コンテナ（一括時のマージン調整） ===== */
    .report-wrapper {
        width: 100%;
        page-break-inside: avoid;
    }

    /* ===== ヘッダー ===== */
    .report-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 2px;
    }
    .report-header h1 {
        font-size: 20px;
        font-weight: 700;
        color: #000;
    }
    .report-header .worker-info {
        font-size: 20px;
        font-weight: 700;
        border-bottom: 2px solid #000;
        padding: 0 4px 1px;
    }
    .report-header .worker-info span { color: #000; }

    /* ===== テーブル ===== */
    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }
    th, td {
        border: 1px solid #000;
        padding: 1px 2px;
        text-align: center;
        vertical-align: middle;
        line-height: 1.2;
    }
    .day-header {
        font-weight: 400;
        font-size: 16px;
        color: #000;
        border-top: 2px solid #000;
        border-bottom: 2px solid #000;
        border-left: 2px solid #000;
        border-right: 2px solid #000;
        height: 44px;
    }
    .day-header .dow { font-size: 13px; }
    .corner-cell {
        font-weight: 400;
        font-size: 10px;
        color: #000;
        border: 2px solid #000;
        text-align: left;
        height: 44px;
        padding: 0;
        position: relative;
        background:
            linear-gradient(to top right,
                transparent calc(50% - 1px), #000 calc(50% - 1px),
                #000 calc(50% + 1px), transparent calc(50% + 1px));
    }
    .corner-cell .cc-date {
        position: absolute;
        top: 2px;
        right: 4px;
        font-size: 10px;
    }
    .corner-cell .cc-item {
        position: absolute;
        bottom: 2px;
        left: 4px;
        font-size: 10px;
    }
    .group-cell {
        font-weight: 400;
        font-size: 13px;
        color: #000;
        width: 25px;
        min-width: 25px;
        max-width: 25px;
        writing-mode: vertical-rl;
        text-orientation: upright;
        text-align: center;
        vertical-align: middle;
        border: 2px solid #000;
    }
    .item-cell {
        font-weight: 400;
        font-size: 10px;
        color: #000;
        border-left: 2px solid #000;
        border-right: 2px solid #000;
    }
    .item-label-name { width: 36px; min-width: 36px; } /* 名前カラム */
    .item-label-qty { width: 33px; min-width: 33px; font-size: 9px; } /* 数量カラム */
    .vertical-label { writing-mode: vertical-rl; text-orientation: upright; padding: 2px 0; }

    .item-cell.sub-item {
        font-weight: 400;
        color: #000;
    }
    .data-cell {
        font-size: 11px;
        color: #000;
        background: #fff;
        border-left: 2px solid #000;
        border-right: 2px solid #000;
    }
    .data-cell-l { text-align: left; padding-left: 2px; }
    .data-cell-r {
        text-align: center;
        width: 33px;      /* ← ここで右側（人数・サイン側）の幅を固定します */
        min-width: 33px;
        max-width: 33px;
    }

    .site-name {
        font-weight: 400;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        height: 23px;
    }
    .site-name.site-name-first { height: 28px; }
    .time-data { font-size: 10px; height: 23px; white-space: pre-line; }
    .time-data.time-data-first { height: 28px; }
    .content-data {
        font-size: 10px;
        text-align: left;
        padding-left: 3px;
        height: 91px;
        overflow: hidden;
        white-space: pre-line;
    }
    .daily-total { font-weight: 400; height: 52px; }
    .note-cell { height: 52px; text-align: left; padding-left: 4px; }
    .sign-cell { height: 43px; }
    .sub-row { height: 34px; }
    .footnote {
        font-size: 8px;
        line-height: 1.4;
        text-align: left;
        padding: 1px 3px;
        border: 2px solid #000;
        border-top: none;
    }

    @media print {
        body { margin: 0; }
        .no-print { display: none !important; }
    }
    @media screen {
        body { padding: 12px; background: #e8e8e8; }
        .page-wrap { max-width: 1150px; margin: 0 auto; background: #fff; padding: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.12); }
        .report-header { max-width: 1150px; margin-left: auto; margin-right: auto; }
    }
    .print-btn-bar {
        text-align: center;
        padding: 10px;
        margin-bottom: 8px;
    }
    .print-btn-bar button {
        padding: 10px 36px;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        background: #000;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }
    .print-btn-bar button:hover { background: #333; }
`;

/**
 * 日報用HTMLパーツ（単一作業員用）を生成するヘルパー
 */
const createWorkerReportHTMLPart = (workerName, days, recordsData, projects, subcontractorsData, companyHolidays, overtimeApprovals = [], workAllowanceApprovals = []) => {
    const dayNames = ["(月)", "(火)", "(水)", "(木)", "(金)", "(土)", "(日)"];

    // 日付ごと・現場ごとのグループ化
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

    // 日付ヘッダー
    const dateHeaders = days.map((d, i) => {
        const parts = d.split('-');
        return `<th class="day-header" colspan="2">${parseInt(parts[1])}/${parseInt(parts[2])}<br/><span class="dow">${dayNames[i]}</span></th>`;
    }).join('');

    // ======== 現場ブロック（現場①②③ 各3行）========
    // Excel側は1つ目のブロックのみ行が高い（名前28px/時間28px、2・3つ目は23px）ため、
    // レイアウトを一致させるために先頭ブロックだけ専用クラスを付与する
    let siteRowsHTML = '';
    for (let g = 0; g < 3; g++) {
        const sizeClass = g === 0 ? '-first' : '';
        let nameRow = `<td rowspan="3" class="group-cell">現場&#${9312 + g};</td><td class="item-cell" colspan="2" style="font-size: 12px;">現場名</td>`;
        let timeRow = `<td class="item-cell" colspan="2" style="font-size: 12px;">時間</td>`;
        let contentRow = `<td class="item-cell" colspan="2" style="font-size: 12px;">作業<br/>内容</td>`;

        days.forEach(d => {
            const group = (dateProjectMap[d] || [])[g];
            if (group) {
                nameRow += `<td class="data-cell site-name${sizeClass}" colspan="2">${esc(group.siteName)}</td>`;
                let timeText = '';
                let timeStyle = '';
                if (group.timeSlots.length > 0) {
                    const slotTexts = group.timeSlots.map(s => `${s.start} 〜 ${s.end}`);
                    const unique = [...new Set(slotTexts)];
                    timeText = unique.join('<br/>');

                    if (unique.length >= 3) {
                        timeStyle = 'font-size: 7.0px; line-height: 1.1;';
                    } else if (unique.length === 2) {
                        timeStyle = 'font-size: 9.5px; line-height: 1.1;';
                    }
                }
                timeRow += `<td class="data-cell time-data${sizeClass}" colspan="2" style="${timeStyle}">${timeText || ': 　〜　:'}</td>`;
                const uniqueItems = [...new Set(group.items)];
                let contentStyle = '';
                if (uniqueItems.length >= 6) {
                    contentStyle = 'font-size: 7.0px; line-height: 1.1;';
                } else if (uniqueItems.length === 5) {
                    contentStyle = 'font-size: 8.5px; line-height: 1.1;';
                } else if (uniqueItems.length === 4) {
                    contentStyle = 'font-size: 9.5px; line-height: 1.1;';
                }
                contentRow += `<td class="data-cell content-data" colspan="2" style="${contentStyle}">${uniqueItems.map(i => esc(i)).join('<br/>')}</td>`;
            } else {
                nameRow += `<td class="data-cell site-name${sizeClass}" colspan="2">&nbsp;</td>`;
                timeRow += `<td class="data-cell time-data${sizeClass}" colspan="2">: 　〜　:</td>`;
                contentRow += `<td class="data-cell content-data" colspan="2">&nbsp;</td>`;
            }
        });
        siteRowsHTML += `<tr>${nameRow}</tr><tr>${timeRow}</tr><tr>${contentRow}</tr>`;
    }

    // ======== 協力会社（3社 × 1行 = 3行）========
    let subcontractorsHTML = '';
    for (let c = 0; c < 3; c++) {
        const isFirst = c === 0;
        let row = isFirst ? `<td rowspan="3" class="group-cell">協力会社</td>` : '';
        row += `<td class="item-cell item-label-name">社名${['①', '②', '③'][c]}</td>`;
        row += `<td class="item-cell item-label-qty sub-item">人数</td>`;
        days.forEach(d => {
            const daySubs = (subcontractorsData || []).filter(s => s.date === d);
            const sub = daySubs[c];
            row += `<td class="data-cell data-cell-l">${sub ? esc(sub.company_name) : '&nbsp;'}</td>`;
            row += `<td class="data-cell data-cell-r">${sub ? sub.worker_count : '&nbsp;'}</td>`;
        });
        subcontractorsHTML += `<tr class="sub-row">${row}</tr>`;
    }

    // ======== 使用材料（3行 × 1行 = 3行）========
    let materialRowsHTML = '';
    for (let m = 0; m < 3; m++) {
        const isFirst = m === 0;
        let matRow = isFirst ? `<td rowspan="3" class="group-cell">使用材料</td>` : '';
        matRow += `<td class="item-cell item-label-name">材料名</td>`;
        matRow += `<td class="item-cell item-label-qty sub-item">数量</td>`;
        for (let i = 0; i < 7; i++) {
            matRow += `<td class="data-cell data-cell-l">&nbsp;</td>`;
            matRow += `<td class="data-cell data-cell-r">&nbsp;</td>`;
        }
        materialRowsHTML += `<tr class="sub-row">${matRow}</tr>`;
    }

    // ======== 作業手当（1行：時間(H) / 承認サイン を横並び）========
    // 時間外時間の合計に加え、手当対象作業（work_allowance）の「作業名 実働h」を併記する
    let otRow = `<td class="group-cell">作業手当</td>`;
    otRow += `<td class="item-cell item-label-name" style="writing-mode: horizontal-tb; text-align: center; vertical-align: middle; font-size: 12px; line-height: 1.1;">時<br/>感<br/>(H)</td>`;
    otRow += `<td class="item-cell item-label-qty sub-item vertical-label">承認サイン</td>`;
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const dayOt = dayRecords.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0);

        // 手当対象作業を作業項目ごとに集計
        const taskMap = {};
        dayRecords.forEach(r => {
            if (!r.work_allowance) return;
            const taskName = r.ProjectTasks?.name || '不明な作業';
            taskMap[taskName] = (taskMap[taskName] || 0) + Number(r.hours || 0);
        });
        // 対象工種がある現場のうち、承認されていない現場が1つでもあれば「未承認」
        const allowanceProjectIds = [...new Set(
            dayRecords.filter(r => r.work_allowance).map(r => String(r.project_id))
        )];
        const hasUnapprovedAllowance = allowanceProjectIds.some(pid =>
            !(workAllowanceApprovals || []).some(a =>
                String(a.project_id) === pid && a.date === d && a.status === 'approved'
            )
        );
        const allowanceLines = Object.entries(taskMap).map(([name, hours]) =>
            `${esc(name)} ${hours.toFixed(1)}h${hasUnapprovedAllowance ? '（未承認）' : ''}`
        );

        const lines = [];
        let approverName = '';
        if (dayOt > 0) {
            // その日に残業がある現場のうち、承認されていない現場が1つでもあれば「未承認」
            const otProjectIds = [...new Set(
                dayRecords.filter(r => Number(r.overtime_hours || 0) > 0).map(r => String(r.project_id))
            )];
            const hasUnapproved = otProjectIds.some(pid =>
                !(overtimeApprovals || []).some(a =>
                    String(a.project_id) === pid && a.date === d && a.status === 'approved'
                )
            );
            lines.push(`残業 ${dayOt.toFixed(1)}H${hasUnapproved ? '（未承認）' : ''}`);

            // 承認サイン: その日の承認済み残業の承認者（職長）名を表示する
            const approvedRow = (overtimeApprovals || []).find(a =>
                otProjectIds.includes(String(a.project_id)) &&
                a.date === d && a.status === 'approved' && a.approved_by
            );
            if (approvedRow) approverName = approvedRow.approved_by;
        }
        lines.push(...allowanceLines);

        // 承認サインが未設定なら、作業手当の承認者名で補完する
        if (!approverName && allowanceProjectIds.length > 0) {
            const approvedAllowanceRow = (workAllowanceApprovals || []).find(a =>
                allowanceProjectIds.includes(String(a.project_id)) &&
                a.date === d && a.status === 'approved' && a.approved_by
            );
            if (approvedAllowanceRow) approverName = approvedAllowanceRow.approved_by;
        }

        const cellHTML = lines.length > 0 ? lines.join('<br/>') : '&nbsp;';
        otRow += `<td class="data-cell data-cell-l" style="font-size: 9px; line-height: 1.15; text-align: left; padding: 1px 2px;">${cellHTML}</td>`;
        otRow += `<td class="data-cell data-cell-r sign-cell">${approverName ? esc(approverName) : '&nbsp;'}</td>`;
    });

    // ======== 備考（1行：日計 実働/人工 を表示）========
    let dailyTotalRow = `<td class="group-cell">備考</td><td class="item-cell" colspan="2">実働/人工</td>`;
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const dayTotal = dayRecords.reduce((sum, r) => sum + Number(r.hours || 0), 0);
        if (dayTotal > 0) {
            const dayNinku = calculateNinku(dayTotal, d);
            dailyTotalRow += `<td class="data-cell daily-total" colspan="2">${dayTotal.toFixed(1)}h（${dayNinku}人工）</td>`;
        } else {
            dailyTotalRow += `<td class="data-cell note-cell" colspan="2">&nbsp;</td>`;
        }
    });

    const startYear = new Date(days[0]).getFullYear();
    const reiwaYear = startYear - 2018;

    return `
    <div class="report-wrapper">
        <div class="report-header">
            <h1>就 労 日 報（R${reiwaYear}）</h1>
            <div class="worker-info">作業者名：<span>${esc(workerName)}</span></div>
        </div>

        <div class="page-wrap">
            <table>
                <colgroup>
                    <col style="width: 25px;"> <!-- グループラベル（現場、協力等） -->
                    <col style="width: 36px;"> <!-- 項目名（左） -->
                    <col style="width: 33px;"> <!-- 項目名（右：人数・数量） -->
                    <!-- 7日間 × 2列（内容・数値） -->
                    <col style="width: 135px;"><col style="width: 33px;">
                    <col style="width: 135px;"><col style="width: 33px;">
                    <col style="width: 135px;"><col style="width: 33px;">
                    <col style="width: 135px;"><col style="width: 33px;">
                    <col style="width: 135px;"><col style="width: 33px;">
                    <col style="width: 135px;"><col style="width: 33px;">
                    <col style="width: 135px;"><col style="width: 33px;">
                </colgroup>
                <thead>
                    <tr>
                        <th class="corner-cell" colspan="3"><span class="cc-date">日付</span><span class="cc-item">項目</span></th>
                        ${dateHeaders}
                    </tr>
                </thead>
                <tbody>
                    <!-- 現場①②③ -->
                    ${siteRowsHTML}

                    <!-- 協力会社（3社 × 2行） -->
                    ${subcontractorsHTML}

                    <!-- 使用材料（3行 × 2行） -->
                    ${materialRowsHTML}

                    <!-- 作業手当 -->
                    <tr>${otRow}</tr>

                    <!-- 備考（日計 実働/人工） -->
                    <tr>${dailyTotalRow}</tr>
                </tbody>
            </table>
            <div class="footnote">
                ※作業手当時間欄：対象作業がある場合、作業内容と作業時間を記入しすること。<br/>
                　手当対象作業：ブラスト、ブラスト砂回収、吹付け、屋根吹付け（手元は無し）、金属溶射、塗膜剥離（吹付け含む）、サンダーケレン、早出・残業（残業予定時間を事前に報告のこと）<br/>
                ※上長承認欄：上長承認が無い場合、支給対象外となる場合があります。
            </div>
        </div>
    </div>
    `;
};

/**
 * 印刷用ウィンドウを開いて印刷ダイアログを表示する共通処理
 */
const openPrintWindow = (html) => {
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.onload = () => {
            setTimeout(() => printWindow.print(), 300);
        };
    } else {
        // 呼び出し側（try/catch）で showToast 表示できるよう例外を送出する
        throw new Error('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    }
};

/**
 * 就労日報のPDF出力（ブラウザ印刷ダイアログ経由）
 * 手書き日報フォームに準拠したレイアウト
 */
export const generateWorkerReportPDF = (workerName, weekPrefix, days, recordsData, projects, subcontractorsData, companyHolidays = []) => {
    const part = createWorkerReportHTMLPart(workerName, days, recordsData, projects, subcontractorsData, companyHolidays);

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>就労日報 - ${esc(workerName)} (${weekPrefix})</title>
<style>
    ${COMMON_CSS_STYLE}
</style>
</head>
<body>
    <div class="print-btn-bar no-print">
        <button onclick="window.print()">🖨 印刷 / PDF保存</button>
    </div>
    ${part}
</body>
</html>`;

    openPrintWindow(html);
};

/**
 * 複数名分の就労日報をまとめて1つの印刷用HTML（改ページ区切り）として出力する
 */
export const generateMultipleWorkersReportPDF = (workersDataList, weekPrefix, companyHolidays = []) => {
    if (!workersDataList || workersDataList.length === 0) return;

    const parts = workersDataList.map((data, idx) => {
        const { workerName, days, recordsData, projects, subcontractorsData, overtimeApprovals, workAllowanceApprovals } = data;
        const part = createWorkerReportHTMLPart(workerName, days, recordsData, projects, subcontractorsData, companyHolidays, overtimeApprovals, workAllowanceApprovals);
        const isLast = idx === workersDataList.length - 1;
        const breakDiv = isLast ? '' : '<div class="page-break"></div>';
        return part + breakDiv;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>就労日報_一括出力_${weekPrefix}</title>
<style>
    ${COMMON_CSS_STYLE}

    /* 一括印刷用の改ページ制御 */
    .page-break {
        page-break-after: always;
        break-after: page;
    }
</style>
</head>
<body>
    <div class="print-btn-bar no-print">
        <button onclick="window.print()">🖨 一括印刷 / PDF保存</button>
    </div>
    ${parts}
</body>
</html>`;

    openPrintWindow(html);
};

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
