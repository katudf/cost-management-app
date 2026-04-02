import * as xlsx from 'xlsx-js-style';

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
        ["作業項目", "作業内容", "作業員", "時間", "日付", "作成日時"]
    ];
    activeProject.records.forEach(r => {
        const taskName = activeProject.masterData.find(m => m.id === r.taskId)?.task || '不明';
        const date = new Date(r.timestamp);
        const dateStr = date.toLocaleDateString('ja-JP');
        const timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

        ws2Data.push([
            taskName,
            r.memo || '',
            r.worker || '未設定',
            r.hours,
            r.date || dateStr,
            `${dateStr} ${timeStr}`
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
        font: { bold: true },
        fill: { fgColor: { rgb: "EFEFEF" } }, // 薄いグレー
        border: borderStyle
    };
    const dataStyle = {
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
                        font: { bold: true, sz: 12 },
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

    // 行のスタイルを残りのシートにも適用
    applyStyleToSheet(ws1, 7);
    applyStyleToSheet(ws2, 6);

    // 作業員別の集計データ作成（追加要件：延べ作業時間と人工の集計）
    const workerHours = {};
    activeProject.records.forEach(r => {
        const workerName = r.worker || '未設定';
        if (!workerHours[workerName]) {
            workerHours[workerName] = 0;
        }
        workerHours[workerName] += Number(r.hours || 0);
    });

    const ws3Data = [
        siteNameRow,
        ["作業員名", "延べ作業時間 (h)", "延べ人工 (8h/人工)"]
    ];

    let totalWorkerHours = 0;
    // 作業時間が多い順にソートして出力
    const sortedWorkers = Object.keys(workerHours).sort((a, b) => workerHours[b] - workerHours[a]);

    sortedWorkers.forEach(worker => {
        const hours = workerHours[worker];
        totalWorkerHours += hours;
        // 人工は小数第2位までに丸める
        const ninku = parseFloat((hours / 8).toFixed(2));
        ws3Data.push([worker, hours, ninku]);
    });

    // 合計行
    ws3Data.push([
        "【合計】",
        totalWorkerHours,
        parseFloat((totalWorkerHours / 8).toFixed(2))
    ]);

    const ws3 = xlsx.utils.aoa_to_sheet(ws3Data);
    applyStyleToSheet(ws3, 3);

    // 列幅の簡易調整
    ws1['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 10 }];
    ws2['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 }];
    ws3['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 20 }];

    xlsx.utils.book_append_sheet(wb, ws1, "現場サマリー");
    xlsx.utils.book_append_sheet(wb, ws2, "作業項目別詳細");
    xlsx.utils.book_append_sheet(wb, ws3, "作業員別集計");

    const today = new Date().toISOString().split('T')[0];
    xlsx.writeFile(wb, `${activeProject.siteName}_工数管理レポート_${today}.xlsx`);
};


/**
 * 就労日報のExcel出力を生成
 * （DB取得済みのデータを受け取り、Excelファイルを生成する）
 * @param {string} workerName 
 * @param {string} weekPrefix 
 * @param {Array} days 
 * @param {Array} recordsData 
 * @param {Array} projects 
 * @param {Array} subcontractorsData 
 */
export const generateWorkerReportExcel = (workerName, weekPrefix, days, recordsData, projects, subcontractorsData) => {
    const sheetData = [];
    sheetData.push(["就労日報 (R8)", null, null, null, null, `作業者名: ${workerName}`, null, null]);

    const dateRow = ["日付", "項目"];
    const dayNames = ["(月)", "(火)", "(水)", "(木)", "(金)", "(土)", "(日)"];
    days.forEach((d, i) => {
        const parts = d.split('-');
        dateRow.push(`${parseInt(parts[1])}/${parseInt(parts[2])}\n${dayNames[i]}`);
    });
    sheetData.push(dateRow);

    const dateProjectMap = {};
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const projGroups = {};
        dayRecords.forEach(r => {
            const pid = r.ProjectTasks?.projectId || r.project_id;
            if (!projGroups[pid]) {
                const proj = projects.find(p => p.id === pid);
                projGroups[pid] = { siteName: proj?.siteName || '不明な現場', items: [], sumHours: 0, sumOvertime: 0 };
            }
            projGroups[pid].items.push(r.ProjectTasks?.name || '不明な作業');
            projGroups[pid].sumHours += Number(r.hours || 0);
            projGroups[pid].sumOvertime += Number(r.overtime_hours || 0);
        });
        dateProjectMap[d] = Object.values(projGroups);
    });

    for (let g = 0; g < 3; g++) {
        const genbaNameRow = [`現場${g + 1}`, "現場名"];
        const timeRow = ["", "時間"];
        const contentRow = ["", "作業内容"];

        days.forEach(d => {
            const group = dateProjectMap[d][g];
            if (group) {
                genbaNameRow.push(group.siteName);
                let otText = '';
                if (group.sumOvertime > 0) {
                    otText = `\n(+外${group.sumOvertime}h)`;
                }
                timeRow.push(`${group.sumHours}h${otText}`);
                contentRow.push(group.items.join('\n'));
            } else {
                genbaNameRow.push("");
                timeRow.push("");
                contentRow.push("");
            }
        });
        sheetData.push(genbaNameRow);
        sheetData.push(timeRow);
        sheetData.push(contentRow);
    }

    for (let c = 0; c < 3; c++) {
        const compRow = c === 0 ? ["協力会社", `会社名①`] : ["", `会社名${c === 1 ? '②' : '③'}`];
        days.forEach(d => {
            const daySubs = (subcontractorsData || []).filter(s => s.date === d);
            const sub = daySubs[c];
            if (sub) {
                compRow.push(`${sub.company_name} ( ${sub.worker_count}名 )`);
            } else {
                compRow.push("");
            }
        });
        sheetData.push(compRow);
    }

    const pRow1 = ["使用材料", "材料名"];
    const pRow2 = ["", "数量"];
    for (let i = 0; i < 7; i++) { pRow1.push(""); pRow2.push(""); }
    sheetData.push(pRow1);
    sheetData.push(pRow2);

    const otRow = ["作業手当", "時間(H)"];
    days.forEach(d => {
        const dayRecords = (recordsData || []).filter(r => r.date === d);
        const dayOt = dayRecords.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0);
        otRow.push(dayOt > 0 ? `${dayOt}H` : "");
    });
    sheetData.push(otRow);

    const sigRow = ["", "承認サイン"];
    for (let i = 0; i < 7; i++) { sigRow.push(""); }
    sheetData.push(sigRow);

    sheetData.push(["備考", "※手当対象作業：...サンダーケレン、早出・残業（残業予定時間を事前に報告のこと）...", "", "", "", "", "", ""]);

    const ws = xlsx.utils.aoa_to_sheet(sheetData);

    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
        { s: { r: 0, c: 5 }, e: { r: 0, c: 8 } },
        { s: { r: 2, c: 0 }, e: { r: 4, c: 0 } },
        { s: { r: 5, c: 0 }, e: { r: 7, c: 0 } },
        { s: { r: 8, c: 0 }, e: { r: 10, c: 0 } },
        { s: { r: 11, c: 0 }, e: { r: 13, c: 0 } },
        { s: { r: 14, c: 0 }, e: { r: 15, c: 0 } },
        { s: { r: 16, c: 0 }, e: { r: 17, c: 0 } },
        { s: { r: 18, c: 1 }, e: { r: 18, c: 8 } }
    ];

    const range = xlsx.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRefBase = xlsx.utils.encode_cell({ r: R, c: C });
            let cell = ws[cellRefBase];
            if (!cell) {
                ws[cellRefBase] = { t: "s", v: "" };
                cell = ws[cellRefBase];
            }

            if (R < 18) {
                cell.s = {
                    border: {
                        top: { style: "thin" }, bottom: { style: "thin" },
                        left: { style: "thin" }, right: { style: "thin" }
                    },
                    alignment: { vertical: "center", horizontal: "center", wrapText: true }
                };
            } else if (R === 18) {
                cell.s = { font: { sz: 9 } };
            }

            if (R === 0) {
                cell.s = { ...cell.s, font: { bold: true, sz: 14 }, border: {} };
                cell.s.alignment = { horizontal: C === 0 ? "center" : "right" };
            }
        }
    }

    ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "就労日報");
    xlsx.writeFile(wb, `${workerName}_就労日報_${weekPrefix}.xlsx`);
};
