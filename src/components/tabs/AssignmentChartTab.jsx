import React, { useMemo, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { exportAssignmentChartToExcel } from '../../utils/assignmentChartExport';
import { addDays } from '../../utils/dateUtils';
import { useToast } from '../../components/Toast';
import { useAssignmentState } from '../../hooks/useAssignmentState';
import EditColorPopup from '../assignment/EditColorPopup';
import EditHolidayPopup from '../assignment/EditHolidayPopup';
import AssignmentPopup from '../assignment/AssignmentPopup';
import ProjectBarRow from '../assignment/ProjectBarRow';
import WorkerRow from '../assignment/WorkerRow';

// メモ化した行コンポーネントに「変化なし」を安定した参照で伝えるための定数
const EMPTY_ARRAY = [];

const AssignmentChartTab = ({ projects, workers, allProjectsSummary, setActiveTab, setActiveProjectId, setProjects, customers }) => {
    const { showToast } = useToast();

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
        hoverProjectStats,
        setHoverProjectStats,
        clipboard,
        draggingGantt,
        startDate,
        totalDays,
        activeWorkers,
        customerMap,
        dateColumns,
        weekGroups,
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
        popupRef,
        tableContainerRef
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
    const dayHeaderInfo = useMemo(() => dateColumns.map(col => {
        const registered = holidayMap[col.dateStr];
        const isActualHoliday = registered && registered.description !== '会議' && registered.description !== '社員旅行';
        const isToday = col.dateStr === todayStr;
        let bg = null;
        let color = null;
        if (col.dow === 0 || isActualHoliday) {
            bg = '#FEE2E2'; color = '#DC2626';
        } else if (col.dow === 6) {
            bg = '#DBEAFE'; color = '#2563EB';
        }
        return { bg, color, isToday };
    }), [dateColumns, holidayMap, todayStr]);

    const handleNameMouseLeave = useCallback(() => setHoverProjectStats(null), [setHoverProjectStats]);

    const handleOpenProject = useCallback((projectId) => {
        setActiveProjectId(projectId);
        setActiveTab('master');
    }, [setActiveProjectId, setActiveTab]);

    const periodLabel = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()} 〜 ${addDays(startDate, totalDays - 1).getMonth() + 1}/${addDays(startDate, totalDays - 1).getDate()}`;

    // 編集セルの配置データ
    const editCellAssignments = editCell
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
                        onClick={() => exportAssignmentChartToExcel(
                            workers, dateColumns, assignmentLookup, projectMap, barProjects, periodLabel, getBarSpan
                        )}
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
                        <col style={{ width: '140px', minWidth: '140px' }} />
                        {dateColumns.map((_, i) => (
                            <col key={i} style={{ width: '48px', minWidth: '48px' }} />
                        ))}
                    </colgroup>

                    {/* 日付ヘッダー */}
                    <thead>
                        <tr>
                            <th
                                className="sticky left-0 z-20 bg-slate-700 text-white text-xs font-bold p-2 border border-slate-600"
                                rowSpan={2}
                            >
                                現場名
                            </th>
                            {weekGroups.map((wg, wi) => (
                                <th
                                    key={wi}
                                    colSpan={wg.days.length}
                                    className="bg-slate-700 text-white text-[10px] font-bold p-1 border border-slate-600 text-center"
                                >
                                    {wg.label}〜
                                </th>
                            ))}
                        </tr>
                        <tr>
                            {dateColumns.map((col, i) => {
                                const info = dayHeaderInfo[i];
                                return (
                                    <th
                                        key={i}
                                        className="text-[10px] font-bold p-1 border border-slate-300 text-center"
                                        style={{
                                            backgroundColor: info.isToday ? '#2563EB' : (info.bg || '#F8FAFC'),
                                            color: info.isToday ? 'white' : undefined
                                        }}
                                    >
                                        <div style={{ color: info.isToday ? 'white' : (info.color || undefined) }}>{col.day}</div>
                                        <div style={{ color: info.isToday ? '#BFDBFE' : (info.color || '#64748B') }}>
                                            {col.dowLabel}
                                        </div>
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
                                getBarSpan={getBarSpan}
                                handleGanttPointerDown={handleGanttPointerDown}
                                handleProjectReorder={handleProjectReorder}
                                onNameMouseEnter={handleProjectNameMouseEnter}
                                onNameMouseLeave={handleNameMouseLeave}
                                onOpenProject={handleOpenProject}
                            />
                        ))}

                        {barProjects.length === 0 && (
                            <tr>
                                <td className="sticky left-0 z-10 bg-white text-xs text-slate-400 p-2 border border-slate-200 italic">
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
                            <td className="sticky left-0 z-20 bg-slate-700 text-white text-xs font-bold p-2 border border-slate-600">
                                作業員名
                            </td>
                            {dateColumns.map((col, i) => {
                                const info = dayHeaderInfo[i];
                                return (
                                    <td
                                        key={i}
                                        className="text-[10px] font-bold p-1 border border-slate-600 text-center"
                                        style={{
                                            backgroundColor: info.isToday ? '#2563EB' : (info.bg || '#334155'),
                                            color: info.isToday ? 'white' : (info.color || 'white')
                                        }}
                                    >
                                        {col.day}
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>

                    {/* 作業員配置表 */}
                    <tbody>
                        {/* 会社行事/休日 行 */}
                        <tr className="bg-slate-100 border-b-2 border-slate-300 bg-stripes">
                            <td className="sticky left-0 z-10 bg-slate-100 text-xs font-bold p-2 border border-slate-200 truncate text-slate-600"
                                style={{ boxShadow: '2px 0 5px -2px rgba(0,0,0,0.1)' }}
                            >
                                会社行事/休日
                            </td>
                            {dateColumns.map((col, i) => {
                                const holidayObj = holidayMap[col.dateStr];
                                const isWeekend = col.dow === 0 || col.dow === 6;

                                let bgColor = 'transparent';
                                if (holidayObj) {
                                    bgColor = holidayObj.description === '会議' ? '#BAE6FD' : // light sky blue
                                        holidayObj.description === '社員旅行' ? '#DDD6FE' : // light purple
                                            '#FECACA'; // light red (default/holiday)
                                } else if (isWeekend) {
                                    bgColor = '#F1F5F9';
                                }

                                const displayText = holidayObj?.description === '会議' ? '会議' :
                                    holidayObj?.description === '社員旅行' ? '旅行' :
                                        holidayObj ? '休' : '';

                                const textColor = holidayObj?.description === '会議' ? 'text-sky-700' :
                                    holidayObj?.description === '社員旅行' ? 'text-violet-700' :
                                        'text-red-600';

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
                                                top: rect.bottom - (containerRect?.top || 0) + (tableContainerRef.current?.scrollTop || 0),
                                                left: rect.left - (containerRect?.left || 0) + (tableContainerRef.current?.scrollLeft || 0)
                                            });
                                        }}
                                        className={`border p-0 text-center align-middle cursor-pointer transition-colors relative ${isEditingEvent ? 'border-2 border-slate-500' : 'border-slate-300 hover:bg-slate-200/50'}`}
                                        style={{
                                            backgroundColor: isEditingEvent ? '#E2E8F0' : bgColor,
                                            height: '24px'
                                        }}
                                    >
                                        {holidayObj && (
                                            <div className={`flex items-center justify-center h-full text-[10px] ${textColor} font-bold`}>
                                                {displayText}
                                            </div>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>

                        {activeWorkers.map((worker, widx) => (
                            <WorkerRow
                                key={worker.id}
                                worker={worker}
                                widx={widx}
                                dateColumns={dateColumns}
                                assignmentLookup={assignmentLookup}
                                taskRecordLookup={taskRecordLookup}
                                projectMap={projectMap}
                                todayStr={todayStr}
                                rowEditCell={editCell && editCell.workerId === worker.id ? editCell : null}
                                rowDragCells={dragWorkerId === worker.id ? dragCells : EMPTY_ARRAY}
                                isRowDragging={isDragging && dragWorkerId === worker.id}
                                onCellMouseDown={handleCellMouseDown}
                                onCellMouseEnter={handleCellMouseEnter}
                                onCellClick={handleCellClick}
                                onDropProject={addAssignment}
                            />
                        ))}

                        {workers.length === 0 && (
                            <tr>
                                <td className="sticky left-0 z-10 bg-white text-xs text-slate-400 p-2 border border-slate-200 italic">
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
                onClose={() => setEditColorPopup(null)}
                onSelectColor={updateProjectColor}
            />
        </div>
    );
};

export default React.memo(AssignmentChartTab);
