import React from 'react';
import { Calendar, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { exportAssignmentChartToExcel } from '../../utils/assignmentChartExport';
import { addDays } from '../../utils/dateUtils';
import { useToast } from '../../components/Toast';
import { useAssignmentState } from '../../hooks/useAssignmentState';
import EditColorPopup from '../assignment/EditColorPopup';
import EditHolidayPopup from '../assignment/EditHolidayPopup';
import AssignmentPopup from '../assignment/AssignmentPopup';
import { SCHEDULE_TYPES } from '../../utils/constants';

const AssignmentChartTab = ({ projects, workers, allProjectsSummary, setActiveTab, setActiveProjectId, setProjects, customers }) => {
    const { showToast } = useToast();

    const {
        isLoading,
        assignments,
        barProjects,
        companyHolidays,
        projectSuspensions,
        editHolidayCell,
        setEditHolidayCell,
        editColorPopup,
        setEditColorPopup,
        editCell,
        setEditCell,
        isDragging,
        dragCells,
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

    const getDayHeaderStyle = (dow, dateStr) => {
        const registered = companyHolidays.find(h => h.date === dateStr);
        const isActualHoliday = registered && registered.description !== '会議' && registered.description !== '社員旅行';
        if (dow === 0 || isActualHoliday) return { backgroundColor: '#FEE2E2', color: '#DC2626' };
        if (dow === 6) return { backgroundColor: '#DBEAFE', color: '#2563EB' };
        return {};
    };

    const shortenName = (name) => {
        if (!name) return '';
        return name.length > 6 ? name.substring(0, 6) : name;
    };

    const handleProjectCellClick = async (proj, dateStr) => {
        // すでに工期が設定されている場合は、バー上での別の操作（カラー変更など）を優先するため何もしない
        if (proj.startDate && proj.endDate) return;
    };

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

            {/* ドラッグ中ヒント */}
            {isDragging && dragCells.length > 0 && (
                <div className="mb-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold flex items-center gap-2 animate-pulse">
                    📌 {dragCells.length}日選択中 — マウスを離すと配置先を選択できます
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
                            {dateColumns.map((col, i) => (
                                <th
                                    key={i}
                                    className="text-[10px] font-bold p-1 border border-slate-300 text-center"
                                    style={{
                                        ...getDayHeaderStyle(col.dow, col.dateStr),
                                        backgroundColor: getDayHeaderStyle(col.dow, col.dateStr).backgroundColor || '#F8FAFC'
                                    }}
                                >
                                    <div>{col.day}</div>
                                    <div style={{ color: getDayHeaderStyle(col.dow, col.dateStr).color || '#64748B' }}>
                                        {col.dowLabel}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>

                    {/* 案件バーチャート */}
                    <tbody>
                        {barProjects.map((proj, idx) => {
                            const isDraggingThis = draggingGantt && draggingGantt.projectId === proj.id;
                            const effStart = isDraggingThis ? draggingGantt.tempStartStr : proj.startDate;
                            const effEnd = isDraggingThis ? draggingGantt.tempEndStr : proj.endDate;
                            const bar = getBarSpan({ startDate: effStart, endDate: effEnd });

                            return (
                                <tr key={proj.id} className="hover:bg-slate-50 transition-colors">
                                    <td
                                        className="sticky left-0 z-10 bg-white text-xs font-bold p-2 border border-slate-200 truncate cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition"
                                        onMouseEnter={(e) => handleProjectNameMouseEnter(e, proj)}
                                        onMouseLeave={() => setHoverProjectStats(null)}
                                        onClick={() => {
                                            setActiveProjectId(proj.id);
                                            setActiveTab('master');
                                        }}
                                        draggable={!isDraggingThis}
                                        onDragStart={(e) => {
                                            if (isDraggingThis) { e.preventDefault(); return; }
                                            e.dataTransfer.setData('projectid', proj.id.toString());
                                            e.dataTransfer.effectAllowed = 'copyMove';
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            e.currentTarget.classList.add('bg-slate-200');
                                        }}
                                        onDragLeave={(e) => {
                                            e.currentTarget.classList.remove('bg-slate-200');
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.currentTarget.classList.remove('bg-slate-200');
                                            const draggedProjId = e.dataTransfer.getData('projectid');
                                            if (draggedProjId) {
                                                handleProjectReorder(parseInt(draggedProjId), proj.id);
                                            }
                                        }}
                                        title="ドラッグで上下に並び替え、またはセルに配置できます"
                                    >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-[10px] text-slate-400 font-mono w-4 flex-shrink-0 text-right">{idx + 1}</span>
                                            <div className="flex flex-col leading-tight min-w-0">
                                                <div className="text-[9px] text-blue-600 font-bold truncate">
                                                    {proj.is_prime_contractor ? '元請' : (customerMap[proj.customerId] || '')}
                                                </div>
                                                <div className="truncate text-slate-800">{proj.name}</div>
                                            </div>
                                        </div>
                                    </td>
                                    {dateColumns.map((col, i) => {
                                        const isInBar = bar && i >= bar.startIdx && i <= bar.endIdx;
                                        const isBarStart = bar && i === bar.startIdx;
                                        const registeredHoliday = companyHolidays.find(h => h.date === col.dateStr);
                                        const isActualHoliday = registeredHoliday && registeredHoliday.description !== '会議' && registeredHoliday.description !== '社員旅行';
                                        const isHolidayOrWeekend = col.dow === 0 || (col.dow === 6 && isActualHoliday) || (col.dow !== 6 && col.dow !== 0 && isActualHoliday);
                                        const suspensionMatch = isInBar ? projectSuspensions.find(s => s.project_id === proj.id && col.dateStr >= s.start_date && col.dateStr <= s.end_date) : null;
                                        const isSuspended = !!suspensionMatch;
                                        const isSuspensionStart = isSuspended && col.dateStr === suspensionMatch.start_date;
                                        // 休工期間の表示スパン計算
                                        const suspensionSpan = isSuspensionStart ? (() => {
                                            const endIdx = dateColumns.findIndex(c => c.dateStr === suspensionMatch.end_date);
                                            const startIdx = i;
                                            return (endIdx >= 0 ? endIdx : dateColumns.length - 1) - startIdx + 1;
                                        })() : 0;
                                        return (
                                            <td
                                                key={i}
                                                onClick={() => handleProjectCellClick(proj, col.dateStr)}
                                                className={`border border-slate-200 p-0 relative ${isInBar ? 'cursor-pointer' : (!proj.startDate || !proj.endDate) ? 'cursor-pointer hover:bg-blue-50/50' : ''}`}
                                                style={{
                                                    backgroundColor: (isInBar && !isHolidayOrWeekend && !isSuspended)
                                                        ? proj.color + (isDraggingThis ? '99' : 'CC')
                                                        : isHolidayOrWeekend ? '#F9FAFB' : 'white',
                                                    ...(isSuspended ? {
                                                        background: `repeating-linear-gradient(45deg, ${proj.color}40, ${proj.color}40 4px, ${proj.color}18 4px, ${proj.color}18 8px)`,
                                                    } : {})
                                                }}
                                                title={isSuspended ? `休工: ${suspensionMatch.reason || ''}` : ''}
                                            >
                                                {isSuspensionStart && suspensionMatch.reason && (
                                                    <div
                                                        className="absolute inset-y-0 left-0 flex items-center text-[12px] font-bold text-orange-700 px-1 whitespace-nowrap overflow-hidden pointer-events-none z-[5]"
                                                        style={{
                                                            width: `${suspensionSpan * 48}px`,
                                                            userSelect: 'none',
                                                            textShadow: '0 0 3px white, 0 0 3px white'
                                                        }}
                                                    >
                                                        <span className="truncate">{suspensionMatch.reason}</span>
                                                    </div>
                                                )}
                                                {isBarStart && (
                                                    <div
                                                        className={`absolute inset-y-0 left-0 flex items-center text-[12px] font-bold text-black px-1 whitespace-nowrap overflow-hidden transition-none ${isDraggingThis ? 'opacity-90 scale-[1.02] shadow-md z-[30]' : 'shadow-sm z-5'}`}
                                                        style={{
                                                            width: `${bar.span * 48}px`,
                                                            userSelect: 'none'
                                                        }}
                                                    >
                                                        <span className="relative z-10 pointer-events-none truncate">{proj.name}</span>
                                                        <div
                                                            className="absolute left-0 top-0 bottom-0 w-3 cursor-w-resize z-20 hover:bg-white/40 border-l-2 border-white/50 pointer-events-auto"
                                                            onPointerDown={(e) => handleGanttPointerDown(e, proj, 'start')}
                                                        ></div>
                                                        <div
                                                            className="absolute left-3 right-3 top-0 bottom-0 cursor-move z-20 hover:bg-white/10 pointer-events-auto"
                                                            onPointerDown={(e) => handleGanttPointerDown(e, proj, 'move')}
                                                        ></div>
                                                        <div
                                                            className="absolute right-0 top-0 bottom-0 w-3 cursor-e-resize z-20 hover:bg-white/40 border-r-2 border-white/50 pointer-events-auto"
                                                            onPointerDown={(e) => handleGanttPointerDown(e, proj, 'end')}
                                                        ></div>
                                                    </div>
                                                )}
                                                <div className="h-6"></div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}

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
                            {dateColumns.map((col, i) => (
                                <td
                                    key={i}
                                    className="text-[10px] font-bold p-1 border border-slate-600 text-center"
                                    style={{
                                        backgroundColor: getDayHeaderStyle(col.dow, col.dateStr).backgroundColor || '#334155',
                                        color: getDayHeaderStyle(col.dow, col.dateStr).color || 'white'
                                    }}
                                >
                                    {col.day}
                                </td>
                            ))}
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
                                const holidayObj = companyHolidays.find(h => h.date === col.dateStr);
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
                            <tr key={worker.id} className={`${widx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50 transition-colors`}>
                                <td className="sticky left-0 z-10 text-xs font-bold p-2 border border-slate-200 truncate"
                                    style={{ backgroundColor: widx % 2 === 0 ? 'white' : '#F8FAFC' }}
                                    title={worker.name}
                                >
                                    <span className="text-slate-400 text-[10px] mr-1">{widx + 1}</span>
                                    {worker.name}
                                </td>
                                {dateColumns.map((col, i) => {
                                    const lookupKey = `${worker.id}_${col.dateStr}`;
                                    const cellAssignments = assignmentLookup[lookupKey] || [];
                                    const isPastDate = col.dateStr <= todayStr;
                                    const actualProjectIds = isPastDate ? (taskRecordLookup[lookupKey] || []) : [];
                                    const isWeekend = col.dow === 0 || col.dow === 6;
                                    const isEditing = editCell && editCell.workerId === worker.id && (
                                        editCell.dragDates ? editCell.dragDates.includes(col.dateStr) : editCell.dateStr === col.dateStr
                                    );
                                    const isDragSelected = isDragging && dragWorkerId === worker.id && dragCells.includes(col.dateStr);

                                    // 過去日付の場合は日報実績を優先表示
                                    const displayItems = isPastDate && actualProjectIds.length > 0
                                        ? actualProjectIds.map(pid => {
                                            const pInfo = projectMap[pid];
                                            return {
                                                key: `actual-${pid}`,
                                                displayName: shortenName(pInfo?.name || '不明'),
                                                bgColor: pInfo?.color || '#94A3B8',
                                                fullName: pInfo?.name || '不明',
                                                isActual: true
                                            };
                                        })
                                        : cellAssignments.map((a, ai) => {
                                            const pInfo = a.projectId ? projectMap[a.projectId] : null;
                                            const schedType = !a.projectId && a.title ? SCHEDULE_TYPES.find(s => s.title === a.title) : null;
                                            return {
                                                key: ai,
                                                displayName: a.title || shortenName(pInfo?.name || ''),
                                                bgColor: schedType?.color || pInfo?.color || '#94A3B8',
                                                fullName: pInfo?.name || a.title || '',
                                                isActual: false
                                            };
                                        });

                                    return (
                                        <td
                                            key={i}
                                            className={`border p-0 text-center align-middle cursor-pointer transition-all ${isDragSelected
                                                ? 'border-blue-500 border-2 bg-blue-100'
                                                : isEditing
                                                    ? 'border-blue-500 border-2 bg-blue-50'
                                                    : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
                                                }`}
                                            style={{
                                                backgroundColor: isDragSelected ? '#DBEAFE' : isEditing ? '#EFF6FF' : isWeekend ? '#F9FAFB' : undefined,
                                                overflow: 'hidden', maxWidth: 0, width: '48px'
                                            }}
                                            onMouseDown={(e) => handleCellMouseDown(e, worker.id, col.dateStr)}
                                            onMouseEnter={() => handleCellMouseEnter(worker.id, col.dateStr)}
                                            onClick={(e) => {
                                                if (!isDragging && dragCells.length <= 1) {
                                                    handleCellClick(e, worker.id, col.dateStr);
                                                }
                                            }}
                                            onDragOver={(e) => {
                                                if (e.dataTransfer.types.includes('projectid')) {
                                                    e.preventDefault();
                                                    e.dataTransfer.dropEffect = 'copy';
                                                }
                                            }}
                                            onDrop={(e) => {
                                                const projectId = e.dataTransfer.getData('projectid');
                                                if (projectId) {
                                                    e.preventDefault();
                                                    addAssignment(worker.id, col.dateStr, Number(projectId), null);
                                                }
                                            }}
                                        >
                                            {displayItems.length > 0 ? (
                                                <div className="flex flex-col gap-0.5 p-0.5" style={{ overflow: 'hidden' }}>
                                                    {displayItems.map((item) => (
                                                        <div
                                                            key={item.key}
                                                            className={`text-[9px] font-bold rounded px-0.5 py-0.5 text-black truncate ${item.isActual ? 'shadow-sm border border-black/20' : ''}`}
                                                            style={{
                                                                background: item.isActual
                                                                    ? `repeating-linear-gradient(-45deg, rgba(255,255,255,0.2), rgba(255,255,255,0.2) 3px, transparent 3px, transparent 6px), ${item.bgColor}`
                                                                    : item.bgColor,
                                                                color: 'black'
                                                            }}
                                                            title={item.fullName + (item.isActual ? '（実績・編集不可）' : '')}
                                                        >
                                                            {item.displayName}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="h-6"></div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
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
