import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Download, Undo2 } from 'lucide-react';
import { exportAssignmentChartToExcel } from '../../utils/assignmentChartExport';
import { addDays, toDateStr, buildDateColumns } from '../../utils/dateUtils';
import { useToast } from '../../components/Toast';
import { useAssignmentState } from '../../hooks/useAssignmentState';
import { useAssignmentCellComments } from '../../hooks/useAssignmentCellComments';
import { useDailyWeatherCodes } from '../../hooks/useWeather';
import { getWeatherIcon } from '../../utils/weatherIcons';
import EditColorPopup from '../assignment/EditColorPopup';
import EditHolidayPopup from '../assignment/EditHolidayPopup';
import CellCommentPopup from '../assignment/CellCommentPopup';
import AssignmentPopup from '../assignment/AssignmentPopup';
import ProjectBarRow from '../assignment/ProjectBarRow';
import WorkerRow from '../assignment/WorkerRow';
import ExportPeriodDialog from '../assignment/ExportPeriodDialog';
import { isNonWorkingDay, getHolidayStyle } from '../../utils/holidayUtils';
import { useProjectNinku, fetchProjectNinkuSummary } from '../../hooks/useProjectNinku';
import { formatNinkuLabels, formatNinkuAsOfLabel, parseTargetNinkuInput, NINKU_SOURCE_NOTE } from '../../utils/ninkuDisplay';

// メモ化した行コンポーネントに「変化なし」を安定した参照で伝えるための定数
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};
// Excel出力で指定できる最大日数
const MAX_EXPORT_DAYS = 366;
const DEFAULT_EXPORT_DAYS = 28;
const DAY_MS = 1000 * 60 * 60 * 24;
const WEEK_BORDER = '2px solid #64748B';
// 左に固定する列の幅（現場名・人工）
const NAME_COL_WIDTH = 140;
const NINKU_COL_WIDTH = 64;
// 人工の基準日の日付見出しに付ける印（下辺の橙線）
const NINKU_AS_OF_MARK = 'inset 0 -4px 0 #F59E0B';

const AssignmentChartTab = ({ projects, workers, allProjectsSummary, setActiveTab, setActiveProjectId, setProjects, customers }) => {
    const { showToast } = useToast();
    // 日付ヘッダー下に表示する天気マーク（予報期間外の日は空欄）
    const { iconByDate: weatherIconByDate } = useDailyWeatherCodes();

    const {
        isLoading,
        assignments,
        barProjects,
        holidayMap,
        suspensionsByProject,
        editHolidayCell,
        setEditHolidayCell,
        editColorPopup,
        setEditColorPopup,
        editCell,
        setEditCell,
        isDragging,
        dragCells,
        dragWorkerId,
        dragWorkerIds,
        hoverProjectStats,
        setHoverProjectStats,
        clipboard,
        draggingGantt,
        startDate,
        totalDays,
        activeWorkers,
        customerMap,
        dateColumns,
        todayStr,
        projectMap,
        allProjects,
        assignmentLookup,
        taskRecordLookup,
        handleGanttPointerDown,
        handleActionDelete,
        handleActionCopy,
        handleActionCut,
        handleActionPaste,
        addAssignment,
        removeAssignment,
        handleAssignmentReorder,
        handleProjectReorder,
        updateProjectColor,
        updateCompanyHoliday,
        handleCellMouseDown,
        handleCellMouseEnter,
        handleCellClick,
        handleProjectNameMouseEnter,
        handlePopupAssign,
        movePeriod,
        goToToday,
        getBarSpan,
        fetchAssignmentLookupForRange,
        popupRef,
        tableContainerRef,
        undo,
        canUndo
    } = useAssignmentState({
        projects,
        workers,
        customers,
        setProjects,
        showToast,
        setActiveProjectId,
        setActiveTab,
        allProjectsSummary
    });

    // 日付ヘッダーのスタイルを列ごとに事前計算（セルごとの再計算を排除）
    const dayHeaderInfo = useMemo(() => dateColumns.map((col, i) => {
        const registered = holidayMap[col.dateStr];
        const isToday = col.dateStr === todayStr;
        let bg = null;
        let color = null;
        if (isNonWorkingDay(col.dow, registered)) {
            bg = '#FEE2E2'; color = '#DC2626';
        } else if (col.dow === 6) {
            bg = '#DBEAFE'; color = '#2563EB';
        }
        // 週の区切り線
        const isWeekStart = i > 0 && dateColumns[i - 1].weekIdx !== col.weekIdx;
        return { bg, color, isToday, isWeekStart };
    }), [dateColumns, holidayMap, todayStr]);

    // 配置そのものが変わったとき（追加・削除・移動、他の人の編集の realtime 反映）だけ数を進める。
    // 表示期間の移動で配置を読み直しただけのときは、今日までの合計は変わらないので取り直さない。
    const periodKey = toDateStr(startDate);
    const [assignmentEditCount, setAssignmentEditCount] = useState(0);
    const lastPeriodKeyRef = useRef(null);
    useEffect(() => {
        if (isLoading) return;
        if (lastPeriodKeyRef.current !== periodKey) {
            lastPeriodKeyRef.current = periodKey;
            return;
        }
        setAssignmentEditCount(c => c + 1);
    }, [assignments, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    // 現場ごとの「消化人工/目標人工」。集計はバーに出す現場だけに絞る
    const barProjectIds = useMemo(() => barProjects.map(p => p.id), [barProjects]);
    const handleNinkuLoadError = useCallback(() => {
        showToast('人工の集計を取得できませんでした（人工列は空欄になります）', 'error');
    }, [showToast]);
    // 人工の基準日。日付見出し（上の日付行・「作業員名」の行）を押すとその日になる。null は今日（タブを開き直すと今日に戻る）
    const [ninkuAsOf, setNinkuAsOf] = useState(null);
    const ninkuAsOfStr = ninkuAsOf || todayStr;
    const isNinkuAsOfToday = ninkuAsOfStr === todayStr;
    const ninkuAsOfLabel = formatNinkuAsOfLabel(ninkuAsOfStr, todayStr);
    const handleNinkuDatePick = useCallback((dateStr) => setNinkuAsOf(dateStr), []);
    // 日付見出しのセルを、押すと基準日を切り替えるボタンにする（キーボードでも Enter/Space で切り替える）
    const ninkuDateHeaderProps = (col) => {
        const isAsOf = col.dateStr === ninkuAsOfStr;
        const label = formatNinkuAsOfLabel(col.dateStr, todayStr);
        return {
            role: 'button',
            tabIndex: 0,
            'aria-pressed': isAsOf,
            'aria-label': `${label}の人工を表示`,
            title: isAsOf ? `人工の基準日（${label}）` : `クリックで${label}の人工を表示`,
            onClick: () => handleNinkuDatePick(col.dateStr),
            onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNinkuDatePick(col.dateStr);
                }
            }
        };
    };
    const resetNinkuAsOf = useCallback(() => setNinkuAsOf(null), []);
    const { ninkuByProject, loadError: ninkuLoadError, loadedAsOf: ninkuLoadedAsOf, updateTargetNinku } = useProjectNinku({
        projectIds: barProjectIds,
        asOf: ninkuAsOfStr,
        refreshKey: assignmentEditCount,
        enabled: barProjectIds.length > 0,
        onError: handleNinkuLoadError
    });
    const ninkuLabelByProject = useMemo(() => formatNinkuLabels(ninkuByProject), [ninkuByProject]);

    // 目標人工のその場入力（人工セルをクリック → Enter/フォーカス外しで保存、Escで取り消し）
    const [editingNinkuProjectId, setEditingNinkuProjectId] = useState(null);
    const ninkuByProjectRef = useRef(ninkuByProject);
    ninkuByProjectRef.current = ninkuByProject;
    const handleStartNinkuEdit = useCallback((projectId) => setEditingNinkuProjectId(projectId), []);
    const handleCancelNinkuEdit = useCallback(() => setEditingNinkuProjectId(null), []);
    const handleSaveNinku = useCallback(async (projectId, input) => {
        setEditingNinkuProjectId(null);
        const value = parseTargetNinkuInput(input);
        if (value === undefined) {
            showToast('目標人工は0以上の整数で入力してください', 'error');
            return;
        }
        const current = ninkuByProjectRef.current[projectId]?.targetNinku ?? null;
        if (current === value) return;
        try {
            await updateTargetNinku(projectId, value);
            showToast(value === null ? '目標人工を未設定にしました' : '目標人工を保存しました', 'success');
        } catch (e) {
            console.error('目標人工の保存に失敗しました:', e);
            showToast('目標人工の保存に失敗しました', 'error');
        }
    }, [showToast, updateTargetNinku]);

    // 人工列は現場名列の右に固定する。表は w-max（中身の幅）なので、現場名列は一番長い現場名に合わせて
    // NAME_COL_WIDTH（最小幅）より広がる（長い現場名を省略せずに見せるための意図した動き）。
    // そのため固定位置は、現場名の見出しの実際の幅を測って決める。
    const [nameColWidth, setNameColWidth] = useState(NAME_COL_WIDTH);
    const nameHeaderObserverRef = useRef(null);
    const nameHeaderRef = useCallback((el) => {
        nameHeaderObserverRef.current?.disconnect();
        nameHeaderObserverRef.current = null;
        if (!el) return;
        const update = () => setNameColWidth(Math.round(el.getBoundingClientRect().width) || NAME_COL_WIDTH);
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        nameHeaderObserverRef.current = ro;
    }, []);

    const handleNameMouseLeave = useCallback(() => setHoverProjectStats(null), [setHoverProjectStats]);

    const handleOpenProject = useCallback((projectId) => {
        setActiveProjectId(projectId);
        setActiveTab('master');
    }, [setActiveProjectId, setActiveTab]);

    // 案件バーのセル（案件×日付）コメント
    const { commentsByProject, saveCellComment, deleteCellComment } = useAssignmentCellComments({ startDate, totalDays, showToast });
    const [editCommentCell, setEditCommentCell] = useState(null);
    // ハンドラ参照を安定させ、全行の再レンダリングを避けるため最新値をrefで参照する
    const commentsByProjectRef = useRef(commentsByProject);
    commentsByProjectRef.current = commentsByProject;

    const handleCellComment = useCallback((proj, dateStr, e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const containerRect = tableContainerRef.current?.getBoundingClientRect();
        setEditCommentCell({
            projectId: proj.id,
            projectName: proj.name,
            dateStr,
            comment: commentsByProjectRef.current[proj.id]?.[dateStr] || '',
            top: rect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
            left: rect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0)
        });
    }, [tableContainerRef]);

    const periodLabel = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()} 〜 ${addDays(startDate, totalDays - 1).getMonth() + 1}/${addDays(startDate, totalDays - 1).getDate()}`;

    const [showExportDialog, setShowExportDialog] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // 期間指定ダイアログの既定値
    const defaultExportStart = toDateStr(startDate);
    // 出力期間の初期値は表示開始日から4週間（A3横1枚に収まる長さ）
    const defaultExportEnd = toDateStr(addDays(startDate, DEFAULT_EXPORT_DAYS - 1));

    const handleExport = useCallback(async (startStr, endStr) => {
        const s = new Date(startStr + 'T00:00:00');
        const e = new Date(endStr + 'T00:00:00');
        if (isNaN(s) || isNaN(e) || s > e) {
            showToast('期間の指定が正しくありません', 'error');
            return;
        }
        const days = Math.round((e - s) / DAY_MS) + 1;
        if (days > MAX_EXPORT_DAYS) {
            showToast(`出力できる期間は最大${MAX_EXPORT_DAYS}日です`, 'error');
            return;
        }

        setIsExporting(true);
        try {
            const lookup = await fetchAssignmentLookupForRange(startStr, endStr);
            // 人工列は画面の基準日時点の値を出力時に取り直して載せる。取れなければ空欄で出すことを知らせる
            let exportNinkuLabels = {};
            try {
                exportNinkuLabels = formatNinkuLabels(await fetchProjectNinkuSummary(barProjects.map(p => p.id), ninkuAsOfStr));
            } catch (ninkuErr) {
                console.error('Excel出力用の人工集計の取得に失敗しました:', ninkuErr);
                showToast('人工の集計を取得できなかったため、人工列は空欄で出力します', 'error');
            }
            const cols = buildDateColumns(s, days);
            // 指定期間を基準にした案件バー範囲
            const spanFn = (project) => {
                if (!project.startDate || !project.endDate) return null;
                const pStart = new Date(project.startDate + 'T00:00:00');
                const pEnd = new Date(project.endDate + 'T00:00:00');
                if (pEnd < s || pStart > e) return null;
                const startIdx = Math.max(0, Math.round((pStart - s) / DAY_MS));
                const endIdx = Math.min(days - 1, Math.round((pEnd - s) / DAY_MS));
                return { startIdx, endIdx, span: endIdx - startIdx + 1 };
            };
            const label = `${s.getFullYear()}/${s.getMonth() + 1}/${s.getDate()} 〜 ${e.getFullYear()}/${e.getMonth() + 1}/${e.getDate()}`;
            exportAssignmentChartToExcel(activeWorkers, cols, lookup, projectMap, barProjects, label, spanFn, exportNinkuLabels, `人工（${ninkuAsOfLabel}）`);
            setShowExportDialog(false);
        } catch (err) {
            console.error('配置表のExcel出力に失敗しました:', err);
            showToast('Excel出力に失敗しました', 'error');
        } finally {
            setIsExporting(false);
        }
    }, [fetchAssignmentLookupForRange, activeWorkers, projectMap, barProjects, showToast]);

    // 列方向（縦）選択・ドラッグ中の作業員集合（O(1)判定用）
    const editCellWorkerIdSet = useMemo(
        () => (editCell && editCell.workerIds ? new Set(editCell.workerIds) : null),
        [editCell]
    );
    const dragWorkerIdSet = useMemo(
        () => (dragWorkerIds && dragWorkerIds.length > 0 ? new Set(dragWorkerIds) : null),
        [dragWorkerIds]
    );

    // 編集セルの配置データ（複数作業員選択時は個別セルの配置内容が一意でないため空扱い）
    const isMultiWorkerEditCell = !!editCell && editCell.workerIds && editCell.workerIds.length > 1;
    const editCellAssignments = editCell && !isMultiWorkerEditCell
        ? (assignmentLookup[`${editCell.workerId}_${editCell.dateStr}`] || [])
        : [];

    const unassignedProjects = editCell
        ? allProjects.filter(p => !editCellAssignments.some(a => a.projectId === p.id))
        : [];

    if (isLoading && assignments.length === 0) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-2">
                    <span className="text-slate-500 font-bold text-sm">配置表データを読み込んでいます...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6" style={{ userSelect: isDragging ? 'none' : 'auto' }}>
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Calendar className="text-blue-600 w-5 h-5" /> 配置表
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={undo}
                        disabled={!canUndo}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        aria-label="元に戻す"
                        title="元に戻す (Ctrl+Z)"
                    >
                        <Undo2 size={18} />
                    </button>
                    <button
                        onClick={() => setShowExportDialog(true)}
                        className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition flex items-center gap-1"
                    >
                        <Download size={14} /> Excel出力
                    </button>

                    <button
                        onClick={() => movePeriod(-1)}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
                        aria-label="前の週"
                        title="前の週"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <button
                        onClick={goToToday}
                        className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition"
                    >
                        今日
                    </button>
                    <span className="text-sm font-bold text-slate-600 min-w-[180px] text-center">
                        {periodLabel}
                    </span>
                    <button
                        onClick={() => movePeriod(1)}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
                        aria-label="次の週"
                        title="次の週"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>

            {isLoading && (
                <div className="h-1 bg-blue-100 overflow-hidden mb-2 rounded">
                    <div className="w-1/2 h-full bg-blue-500 animate-pulse"></div>
                </div>
            )}

            {/* テーブル本体 */}
            <div ref={tableContainerRef} className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm relative">
                <table className="border-collapse w-max min-w-full" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: `${NAME_COL_WIDTH}px`, minWidth: `${NAME_COL_WIDTH}px` }} />
                        <col style={{ width: `${NINKU_COL_WIDTH}px`, minWidth: `${NINKU_COL_WIDTH}px` }} />
                        {dateColumns.map((_, i) => (
                            <col key={i} style={{ width: '48px', minWidth: '48px' }} />
                        ))}
                    </colgroup>

                    {/* 日付ヘッダー */}
                    <thead>
                        <tr>
                            <th
                                ref={nameHeaderRef}
                                className="sticky left-0 z-20 bg-slate-700 text-white text-xs font-bold p-2 border border-slate-600"
                                rowSpan={2}
                            >
                                現場名
                            </th>
                            <th
                                className="sticky z-20 bg-slate-700 text-white text-xs font-bold p-1 border border-slate-600"
                                style={{ left: `${nameColWidth}px` }}
                                rowSpan={2}
                                title={`${ninkuAsOfLabel}の消化人工/目標人工（セルをクリックで目標人工を入力）\n日付の見出しを押すと、その日時点の消化人工に切り替わります\n${NINKU_SOURCE_NOTE}${ninkuLoadError ? '\n※ 集計を取得できませんでした。空欄は未設定とは限りません' : ''}`}
                            >
                                <div>
                                    人工{ninkuLoadError && <span className="ml-0.5 text-amber-300" aria-label="集計を取得できませんでした">!</span>}
                                </div>
                                <div
                                    className={`text-[10px] whitespace-nowrap ${isNinkuAsOfToday ? 'font-normal text-slate-300' : 'font-bold text-amber-300'}`}
                                    aria-live="polite"
                                >
                                    {ninkuAsOfLabel}{ninkuLoadedAsOf !== ninkuAsOfStr && <span aria-label="集計中">…</span>}
                                </div>
                                {!isNinkuAsOfToday && (
                                    <button
                                        type="button"
                                        onClick={resetNinkuAsOf}
                                        aria-label="人工を今日時点に戻す"
                                        title="人工を今日時点に戻す"
                                        className="mt-0.5 text-[10px] font-bold bg-white/15 hover:bg-white/30 rounded px-1 leading-4 whitespace-nowrap"
                                    >
                                        今日に戻す
                                    </button>
                                )}
                            </th>
                            {dateColumns.map((col, i) => {
                                const info = dayHeaderInfo[i];
                                return (
                                    <th
                                        key={i}
                                        className="text-[10px] font-bold p-1 border border-slate-300 text-center cursor-pointer hover:brightness-95"
                                        {...ninkuDateHeaderProps(col)}
                                        style={{
                                            backgroundColor: info.isToday ? '#2563EB' : (info.bg || '#F8FAFC'),
                                            color: info.isToday ? 'white' : undefined,
                                            ...(info.isWeekStart ? { borderLeft: WEEK_BORDER } : {}),
                                            ...(col.dateStr === ninkuAsOfStr ? { boxShadow: NINKU_AS_OF_MARK } : {})
                                        }}
                                    >
                                        <div className="whitespace-nowrap" style={{ color: info.isToday ? 'white' : (info.color || undefined) }}>{col.label}</div>
                                        <div style={{ color: info.isToday ? '#BFDBFE' : (info.color || '#64748B') }}>
                                            {col.dowLabel}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                        {/* 天気マーク（ウェザーニュースの予報期間内＝当日から15日先のみ表示） */}
                        <tr>
                            {dateColumns.map((col, i) => {
                                const info = dayHeaderInfo[i];
                                const weather = getWeatherIcon(weatherIconByDate.get(col.dateStr));
                                return (
                                    <th
                                        key={i}
                                        className="p-0.5 border border-slate-300 text-center align-middle"
                                        style={{
                                            backgroundColor: info.isToday ? '#DBEAFE' : (info.bg || '#F8FAFC'),
                                            ...(info.isWeekStart ? { borderLeft: WEEK_BORDER } : {})
                                        }}
                                    >
                                        {weather ? (
                                            <img
                                                src={weather.url}
                                                alt={weather.label}
                                                title={weather.label}
                                                className="w-6 h-[18px] mx-auto object-contain"
                                            />
                                        ) : (
                                            <div className="h-[18px]" />
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    {/* 案件バーチャート */}
                    <tbody>
                        {barProjects.map((proj, idx) => (
                            <ProjectBarRow
                                key={proj.id}
                                proj={proj}
                                idx={idx}
                                dateColumns={dateColumns}
                                draggingGantt={draggingGantt && draggingGantt.projectId === proj.id ? draggingGantt : null}
                                suspensions={suspensionsByProject[proj.id] || EMPTY_ARRAY}
                                holidayMap={holidayMap}
                                todayStr={todayStr}
                                customerLabel={proj.is_prime_contractor ? '元請' : (customerMap[proj.customerId] || '')}
                                ninkuLabel={ninkuLabelByProject[proj.id] || ''}
                                ninkuLeft={nameColWidth}
                                targetNinku={ninkuByProject[proj.id]?.targetNinku ?? null}
                                isEditingNinku={editingNinkuProjectId === proj.id}
                                onStartNinkuEdit={handleStartNinkuEdit}
                                onSaveNinku={handleSaveNinku}
                                onCancelNinkuEdit={handleCancelNinkuEdit}
                                getBarSpan={getBarSpan}
                                handleGanttPointerDown={handleGanttPointerDown}
                                handleProjectReorder={handleProjectReorder}
                                onNameMouseEnter={handleProjectNameMouseEnter}
                                onNameMouseLeave={handleNameMouseLeave}
                                onOpenProject={handleOpenProject}
                                comments={commentsByProject[proj.id] || EMPTY_OBJECT}
                                onCellComment={handleCellComment}
                            />
                        ))}

                        {barProjects.length === 0 && (
                            <tr>
                                <td colSpan={2} className="sticky left-0 z-10 bg-white text-xs text-slate-400 p-2 border border-slate-200 italic">
                                    案件なし
                                </td>
                                {dateColumns.map((_, i) => (
                                    <td key={i} className="border border-slate-200 p-0">
                                        <div className="h-6"></div>
                                    </td>
                                ))}
                            </tr>
                        )}
                    </tbody>

                    {/* セパレーター */}
                    <tbody>
                        <tr>
                            <td colSpan={2} className="sticky left-0 z-20 bg-slate-700 text-white text-xs font-bold p-2 border border-slate-600">
                                作業員名
                            </td>
                            {dateColumns.map((col, i) => {
                                const info = dayHeaderInfo[i];
                                return (
                                    <td
                                        key={i}
                                        className="text-[10px] font-bold p-1 border border-slate-600 text-center whitespace-nowrap cursor-pointer hover:brightness-110"
                                        {...ninkuDateHeaderProps(col)}
                                        style={{
                                            backgroundColor: info.isToday ? '#2563EB' : (info.bg || '#334155'),
                                            color: info.isToday ? 'white' : (info.color || 'white'),
                                            ...(info.isWeekStart ? { borderLeft: WEEK_BORDER } : {}),
                                            ...(col.dateStr === ninkuAsOfStr ? { boxShadow: NINKU_AS_OF_MARK } : {})
                                        }}
                                    >
                                        {col.label}
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>

                    {/* 作業員配置表 */}
                    <tbody>
                        {/* 会社行事/休日 行 */}
                        <tr className="bg-slate-100 border-b-2 border-slate-300 bg-stripes">
                            <td colSpan={2} className="sticky left-0 z-10 bg-slate-100 text-xs font-bold p-2 border border-slate-200 truncate text-slate-600"
                                style={{ boxShadow: '2px 0 5px -2px rgba(0,0,0,0.1)' }}
                            >
                                会社行事/休日
                            </td>
                            {dateColumns.map((col, i) => {
                                const holidayObj = holidayMap[col.dateStr];
                                const holidayStyle = getHolidayStyle(holidayObj);

                                let bgColor = 'transparent';
                                if (holidayStyle) {
                                    bgColor = holidayStyle.bgColor;
                                } else if (isNonWorkingDay(col.dow, holidayObj)) {
                                    bgColor = '#FEE2E24D';
                                }

                                const displayText = holidayStyle?.shortLabel ?? '';

                                const textColor = holidayStyle?.textColor ?? 'text-red-600';

                                const isEditingEvent = editHolidayCell && editHolidayCell.dateStr === col.dateStr;

                                return (
                                    <td
                                        key={i}
                                        onClick={(e) => {
                                            setEditCell(null);
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const containerRect = tableContainerRef.current?.getBoundingClientRect();
                                            setEditHolidayCell({
                                                dateStr: col.dateStr,
                                                existingId: holidayObj?.id || null,
                                                existingDescription: holidayObj?.description || null,
                                                top: rect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
                                                left: rect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0)
                                            });
                                        }}
                                        className={`border p-0 text-center align-middle cursor-pointer transition-colors relative ${isEditingEvent ? 'border-2 border-slate-500' : 'border-slate-300 hover:bg-slate-200/50'}`}
                                        style={{
                                            backgroundColor: isEditingEvent ? '#E2E8F0' : bgColor,
                                            height: '24px',
                                            ...(dayHeaderInfo[i].isWeekStart && !isEditingEvent ? { borderLeft: WEEK_BORDER } : {})
                                        }}
                                        title={holidayObj?.description || undefined}
                                    >
                                        {holidayObj && (
                                            <div className={`flex items-center justify-center h-full px-0.5 text-[10px] leading-tight ${textColor} font-bold`}>
                                                {/* 長い自由記入は2行まで表示し、それ以上は省略（全文は title で確認） */}
                                                <span className="line-clamp-2 break-all">{displayText}</span>
                                            </div>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>

                        {activeWorkers.map((worker, widx) => {
                            const isInEditCell = editCellWorkerIdSet
                                ? editCellWorkerIdSet.has(worker.id)
                                : editCell && editCell.workerId === worker.id;
                            const isInDragSet = dragWorkerIdSet
                                ? dragWorkerIdSet.has(worker.id)
                                : dragWorkerId === worker.id;
                            return (
                                <WorkerRow
                                    key={worker.id}
                                    worker={worker}
                                    widx={widx}
                                    dateColumns={dateColumns}
                                    holidayMap={holidayMap}
                                    assignmentLookup={assignmentLookup}
                                    taskRecordLookup={taskRecordLookup}
                                    projectMap={projectMap}
                                    todayStr={todayStr}
                                    rowEditCell={isInEditCell ? editCell : null}
                                    rowDragCells={isInDragSet ? dragCells : EMPTY_ARRAY}
                                    isRowDragging={isDragging && isInDragSet}
                                    onCellMouseDown={handleCellMouseDown}
                                    onCellMouseEnter={handleCellMouseEnter}
                                    onCellClick={handleCellClick}
                                    onDropProject={addAssignment}
                                />
                            );
                        })}

                        {workers.length === 0 && (
                            <tr>
                                <td colSpan={2} className="sticky left-0 z-10 bg-white text-xs text-slate-400 p-2 border border-slate-200 italic">
                                    作業員なし
                                </td>
                                {dateColumns.map((_, i) => (
                                    <td key={i} className="border border-slate-200 p-0"><div className="h-6"></div></td>
                                ))}
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* 配置セルの編集ポップアップ */}
                <AssignmentPopup
                    ref={popupRef}
                    editCell={editCell}
                    onClose={() => { setEditCell(null); }}
                    workers={workers}
                    projectMap={projectMap}
                    allProjects={allProjects}
                    editCellAssignments={editCellAssignments}
                    unassignedProjects={unassignedProjects}
                    clipboard={clipboard}
                    handleAssignmentReorder={handleAssignmentReorder}
                    removeAssignment={removeAssignment}
                    handlePopupAssign={handlePopupAssign}
                    handleActionCopy={handleActionCopy}
                    handleActionCut={handleActionCut}
                    handleActionPaste={handleActionPaste}
                    handleActionDelete={handleActionDelete}
                    setActiveProjectId={setActiveProjectId}
                    setActiveTab={setActiveTab}
                />

                {/* 会社行事・休日編集ポップアップ */}
                <EditHolidayPopup
                    editHolidayCell={editHolidayCell}
                    onClose={() => setEditHolidayCell(null)}
                    onUpdateHoliday={updateCompanyHoliday}
                />

                {/* 案件バーのセルコメント編集ポップアップ */}
                <CellCommentPopup
                    editCommentCell={editCommentCell}
                    onClose={() => setEditCommentCell(null)}
                    onSave={saveCellComment}
                    onDelete={deleteCellComment}
                />
            </div>

            {/* 現場名ホバー時のツールチップ */}
            {hoverProjectStats && (
                <div
                    className="fixed z-50 bg-slate-800 text-white rounded-lg shadow-xl p-3 w-56 text-xs pointer-events-none transform -translate-y-1/2"
                    style={{
                        top: `${hoverProjectStats.top}px`,
                        left: `${hoverProjectStats.left + 8}px`
                    }}
                >
                    <div className="font-bold text-[13px] border-b border-slate-700 pb-1.5 mb-1.5 flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: hoverProjectStats.data.bar_color || '#94A3B8' }} />
                        {hoverProjectStats.data.name}
                    </div>
                    <div className="space-y-1 text-slate-300">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">施工元請:</span>
                            <span className="font-bold">
                                {hoverProjectStats.data.is_prime_contractor
                                    ? '元請'
                                    : hoverProjectStats.data.customerId
                                        ? (customerMap[hoverProjectStats.data.customerId] || '未設定')
                                        : '未設定'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">担当職長:</span>
                            <span className="font-bold truncate max-w-[100px] text-right">{hoverProjectStats.foremanName}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">進捗状況:</span>
                            <span className="font-bold text-blue-300">{hoverProjectStats.data.overallProgress}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">消化工数:</span>
                            <span className="font-bold">{hoverProjectStats.data.totalActual}h / {hoverProjectStats.data.totalTarget}h</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">予測粗利:</span>
                            <span className={`font-bold ${hoverProjectStats.data.predictedProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ¥{Math.abs(Math.round(hoverProjectStats.data.predictedProfitLoss || 0)).toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* カラー選択ポップアップ */}
            <EditColorPopup
                editColorPopup={editColorPopup}
                currentColor={barProjects.find(p => p.id === editColorPopup?.projectId)?.color}
                onClose={() => setEditColorPopup(null)}
                onSelectColor={updateProjectColor}
            />

            {/* Excel出力の期間指定ダイアログ */}
            <ExportPeriodDialog
                isOpen={showExportDialog}
                defaultStart={defaultExportStart}
                defaultEnd={defaultExportEnd}
                onClose={() => setShowExportDialog(false)}
                onExport={handleExport}
                isExporting={isExporting}
            />
        </div>
    );
};

export default React.memo(AssignmentChartTab);
