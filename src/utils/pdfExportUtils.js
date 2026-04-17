import { calculateNinku, formatTimeDisplay } from './workTimeUtils';

/**
 * 就労日報のPDF出力（ブラウザ印刷ダイアログ経由）
 * 手書き日報フォームに準拠したレイアウト
 */
export const generateWorkerReportPDF = (workerName, weekPrefix, days, recordsData, projects, subcontractorsData, companyHolidays = []) => {
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
            projGroups[pid].items.push(r.ProjectTasks?.name || '不明な作業');
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
        const isSunday = i === 6; // 月曜始まりの7番目
        const isHoliday = companyHolidays.some(h => h.date === d);
        const style = (isSunday || isHoliday) ? ' style="background-color: #fee2e2; color: #dc2626;"' : '';
        return `<th class="day-header"${style} colspan="2">${parseInt(parts[1])}/${parseInt(parts[2])}<br/>${dayNames[i]}</th>`;
    }).join('');

    // ======== 現場ブロック（現場①②③ 各3行）========
    let siteRowsHTML = '';
    for (let g = 0; g < 3; g++) {
        let nameRow = `<td rowspan="3" class="group-cell">現場&#${9312 + g};</td><td class="item-cell" colspan="2" style="font-size: 12px;">現場名</td>`;
        let timeRow = `<td class="item-cell" colspan="2" style="font-size: 12px;">時間</td>`;
        let contentRow = `<td class="item-cell" colspan="2" style="font-size: 12px;">作業<br/>内容</td>`;

        days.forEach(d => {
            const group = (dateProjectMap[d] || [])[g];
            if (group) {
                nameRow += `<td class="data-cell site-name" colspan="2">${esc(group.siteName)}</td>`;
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
                timeRow += `<td class="data-cell time-data" colspan="2" style="${timeStyle}">${timeText || ': 　〜　:'}</td>`;
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
                nameRow += `<td class="data-cell site-name" colspan="2">&nbsp;</td>`;
                timeRow += `<td class="data-cell time-data" colspan="2">: 　〜　:</td>`;
                contentRow += `<td class="data-cell content-data" colspan="2">&nbsp;</td>`;
            }
        });
        siteRowsHTML += `<tr>${nameRow}</tr><tr>${timeRow}</tr><tr>${contentRow}</tr>`;
    }

    // ======== 協力会社（3社 × 1行 = 3行）========
    let subRowsHTML = '';
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
        subRowsHTML += `<tr style="${c < 2 ? 'border-bottom: 1px dashed #cbd5e1;' : ''}">${row}</tr>`;
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
        materialRowsHTML += `<tr style="${m < 2 ? 'border-bottom: 1px dashed #cbd5e1;' : ''}">${matRow}</tr>`;
    }

    // ======== 作業手当（1行：時間(H) / 承認サイン を横並び）========
    let otRow = `<td class="group-cell">作業手当</td>`;
    otRow += `<td class="item-cell item-label-name" style="writing-mode: horizontal-tb; text-align: center; vertical-align: middle; font-size: 12px; line-height: 1.1;">時<br/>間<br/>(H)</td>`;
    otRow += `<td class="item-cell item-label-qty sub-item vertical-label">承認サイン</td>`;
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const dayOt = dayRecords.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0);
        otRow += `<td class="data-cell data-cell-l">${dayOt > 0 ? dayOt.toFixed(1) + 'H' : '&nbsp;'}</td>`;
        otRow += `<td class="data-cell data-cell-r sign-cell">&nbsp;</td>`;
    });

    // ======== 日計（1行）========
    let dailyTotalRow = `<td class="group-cell daily-total-label">日計</td><td class="item-cell daily-total-label" colspan="2">実働/人工</td>`;
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const dayTotal = dayRecords.reduce((sum, r) => sum + Number(r.hours || 0), 0);
        if (dayTotal > 0) {
            const dayNinku = calculateNinku(dayTotal, d);
            dailyTotalRow += `<td class="data-cell daily-total" colspan="2">${dayTotal.toFixed(1)}h<br/>(${dayNinku}人工)</td>`;
        } else {
            dailyTotalRow += `<td class="data-cell" colspan="2"></td>`;
        }
    });

    // ======== 備考欄（3行分の空白、日ごとに分割）========
    let noteRowsHTML = '';
    for (let n = 0; n < 3; n++) {
        const isFirst = n === 0;
        let row = isFirst ? `<td rowspan="3" class="group-cell">備考</td>` : '';
        row += `<td class="item-cell" colspan="2"></td>`;
        for (let i = 0; i < 7; i++) {
            row += `<td class="data-cell note-cell" colspan="2"></td>`;
        }
        noteRowsHTML += `<tr>${row}</tr>`;
    }

    // 週合計の計算
    let weekTotalHours = 0, weekTotalOvertime = 0;
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        weekTotalHours += dayRecords.reduce((sum, r) => sum + Number(r.hours || 0), 0);
        weekTotalOvertime += dayRecords.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0);
    });
    const weekNinku = (weekTotalHours / 7.5).toFixed(2);

    // 期間表示
    const sp = days[0].split('-'), ep = days[6].split('-');
    const periodStr = `${parseInt(sp[1])}/${parseInt(sp[2])} 〜 ${parseInt(ep[1])}/${parseInt(ep[2])}`;

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>就労日報 - ${esc(workerName)} (${weekPrefix})</title>
<style>
    @page {
        size: A4 landscape;
        margin-top: 10mm;
        margin-bottom: 5mm;
        margin-left: 5mm;
        margin-right: 5mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: "Yu Gothic", "Meiryo", "Hiragino Kaku Gothic Pro", sans-serif;
        font-size: 8.5px;
        color: #111;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    /* ===== ヘッダー ===== */
    .report-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 3px;
        padding: 0 4px;
    }
    .report-header h1 {
        font-size: 24px;
        font-weight: 900;
        letter-spacing: 8px;
        color: #1e3a5f;
    }
    .report-header .worker-info {
        font-size: 24px;
        font-weight: 700;
    }
    .report-header .worker-info span { color: #2563eb; }

    /* 週サマリーバー */
    .week-summary {
        display: flex;
        gap: 14px;
        margin-bottom: 4px;
        padding: 3px 8px;
        background: #eef2ff;
        border: 1px solid #c7d2fe;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 700;
        color: #334155;
    }
    .week-summary .val { color: #1e40af; font-size: 11px; font-weight: 900; }

    /* ===== テーブル ===== */
    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }
    th, td {
        border: 1.2px solid #64748b;
        padding: 2px 3px;
        text-align: center;
        vertical-align: middle;
        line-height: 1.25;
    }
    .day-header {
        background: #e2e8f0;
        font-weight: 700;
        font-size: 12px;
        color: #334155;
        padding: 2px 2px;
    }
    .corner-cell {
        background: #e2e8f0;
        font-weight: 700;
        font-size: 9px;
        color: #334155;
    }
    .group-cell {
        background: #dbeafe;
        font-weight: 900;
        font-size: 13px;
        color: #1e3a5f;
        width: 36px;
        min-width: 36px;
        max-width: 36px;
        writing-mode: vertical-rl;
        text-orientation: upright;
        letter-spacing: 2px;
        text-align: center;
        vertical-align: middle;
    }
    .item-cell {
        background: #f1f5f9;
        font-weight: 700;
        font-size: 10px;
        color: #475569;
    }
    .item-label-name { width: 32px; min-width: 32px; } /* 名前カラム */
    .item-label-qty { width: 22px; min-width: 22px; font-size: 10px; } /* 数量カラム */
    .vertical-label { writing-mode: vertical-rl; text-orientation: upright; padding: 2px 0; }
    
    .item-cell.sub-item {
        background: #f8fafc;
        font-weight: 600;
        color: #64748b;
    }
    .data-cell {
        font-size: 10px;
        color: #1e293b;
        background: #fff;
    }
    .data-cell-l { text-align: left; padding-left: 2px; border-right: none !important; }
    .data-cell-r { 
        text-align: center; 
        border-left: 1px dashed #cbd5e1 !important; 
        width: 25px;      /* ← ここで右側（人数・サイン側）の幅を固定します */
        min-width: 25px; 
        max-width: 25px;
    }
    
    .site-name { 
        font-weight: 700; 
        font-size: 11px; 
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 152px;
    }
    .time-data { font-size: 11px; height: 30px; }
    .content-data { 
        font-size: 11px; 
        text-align: left; 
        padding-left: 3px; 
        height: 55px; 
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 152px; /* 17列構成時の概算幅に合わせて制限 */
    }
    .ot { color: #dc2626; font-weight: 700; }
    .daily-total { font-weight: 700; background: #fef9c3 !important; }
    .daily-total-label { background: #fef9c3 !important; }
    .note-cell { height: 18px; text-align: left; padding-left: 4px; }
    .sign-cell { height: 22px; }

    @media print {
        body { margin: 0; }
        .no-print { display: none !important; }
    }
    @media screen {
        body { padding: 12px; background: #e8e8e8; }
        .page-wrap { max-width: 1150px; margin: 0 auto; background: #fff; padding: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.12); }
        .week-summary { max-width: 1150px; margin-left: auto; margin-right: auto; margin-bottom: 4px; }
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
        background: #2563eb;
        border: none;
        border-radius: 8px;
        cursor: pointer;
    }
    .print-btn-bar button:hover { background: #1d4ed8; }
</style>
</head>
<body>
    <div class="print-btn-bar no-print">
        <button onclick="window.print()">🖨 印刷 / PDF保存</button>
    </div>

    <div class="report-header">
        <h1>就 労 日 報（R8）</h1>
        <div class="week-summary">
            <span>期間: ${periodStr}</span>
            <span>週合計実働: <span class="val">${weekTotalHours.toFixed(1)}h</span></span>
            <span>週合計時間外: <span class="val">${weekTotalOvertime.toFixed(1)}h</span></span>
            <span>週合計人工: <span class="val">${weekNinku}</span></span>
        </div>
        <div class="worker-info">作業者名：<span>${esc(workerName)}</span></div>
    </div>

    <div class="page-wrap">
        <table>
            <colgroup>
                <col style="width: 36px;"> <!-- グループラベル（現場、協力等） -->
                <col style="width: 32px;"> <!-- 項目名（左） -->
                <col style="width: 25px;"> <!-- 項目名（右：人数・数量） -->
                <!-- 7日間 × 2列（内容・数値） -->
                <col><col style="width: 25px;">
                <col><col style="width: 25px;">
                <col><col style="width: 25px;">
                <col><col style="width: 25px;">
                <col><col style="width: 25px;">
                <col><col style="width: 25px;">
                <col><col style="width: 25px;">
            </colgroup>
            <thead>
                <tr>
                    <th class="corner-cell" style="width:36px">日付<br/>項目</th>
                    <th class="corner-cell" colspan="2"></th>
                    ${dateHeaders}
                </tr>
            </thead>
            <tbody>
                <!-- 現場①②③ -->
                ${siteRowsHTML}

                <!-- 協力会社（3社 × 2行） -->
                ${subRowsHTML}

                <!-- 使用材料（3行 × 2行） -->
                ${materialRowsHTML}

                <!-- 作業手当 -->
                <tr>${otRow}</tr>

                <!-- 備考（3行分の手書き欄） -->
                ${noteRowsHTML}

                <!-- 日計 -->
                <tr>${dailyTotalRow}</tr>
            </tbody>
        </table>
    </div>
</body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.onload = () => {
            setTimeout(() => printWindow.print(), 300);
        };
    } else {
        alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    }
};

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
