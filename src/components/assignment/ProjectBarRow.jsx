import React from 'react';

/**
 * 案件バーチャートの1行。
 * React.memo でメモ化し、ガントバードラッグ中は対象行のみ再レンダリングされるよう
 * draggingGantt は「この行のプロジェクトをドラッグ中の場合のみ」親から渡される。
 */
const ProjectBarRow = ({
    proj,
    idx,
    dateColumns,
    draggingGantt, // この行のドラッグ中のみ非null
    suspensions,   // この案件の休工期間のみ
    holidayMap,
    todayStr,
    customerLabel,
    getBarSpan,
    handleGanttPointerDown,
    handleProjectReorder,
    onNameMouseEnter,
    onNameMouseLeave,
    onOpenProject
}) => {
    const isDraggingThis = !!draggingGantt;
    const effStart = isDraggingThis ? draggingGantt.tempStartStr : proj.startDate;
    const effEnd = isDraggingThis ? draggingGantt.tempEndStr : proj.endDate;
    const bar = getBarSpan({ startDate: effStart, endDate: effEnd });

    return (
        <tr className="hover:bg-slate-50 transition-colors">
            <td
                className="sticky left-0 z-10 bg-white text-xs font-bold p-2 border border-slate-200 truncate cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition"
                onMouseEnter={(e) => onNameMouseEnter(e, proj)}
                onMouseLeave={onNameMouseLeave}
                onClick={() => onOpenProject(proj.id)}
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
                            {customerLabel}
                        </div>
                        <div className="truncate text-slate-800">{proj.name}</div>
                    </div>
                </div>
            </td>
            {dateColumns.map((col, i) => {
                const isInBar = bar && i >= bar.startIdx && i <= bar.endIdx;
                const isBarStart = bar && i === bar.startIdx;
                const registeredHoliday = holidayMap[col.dateStr];
                const isActualHoliday = registeredHoliday && registeredHoliday.description !== '会議' && registeredHoliday.description !== '社員旅行';
                const isHolidayOrWeekend = col.dow === 0 || isActualHoliday;
                const isToday = col.dateStr === todayStr;
                const suspensionMatch = isInBar
                    ? suspensions.find(s => col.dateStr >= s.start_date && col.dateStr <= s.end_date)
                    : null;
                const isSuspended = !!suspensionMatch;
                const isSuspensionStart = isSuspended && col.dateStr === suspensionMatch.start_date;
                // 休工期間の表示スパン計算
                const suspensionSpan = isSuspensionStart ? (() => {
                    const endIdx = dateColumns.findIndex(c => c.dateStr === suspensionMatch.end_date);
                    return (endIdx >= 0 ? endIdx : dateColumns.length - 1) - i + 1;
                })() : 0;
                return (
                    <td
                        key={i}
                        className={`border border-slate-200 p-0 relative ${isInBar ? 'cursor-pointer' : (!proj.startDate || !proj.endDate) ? 'cursor-pointer hover:bg-blue-50/50' : ''}`}
                        style={{
                            backgroundColor: (isInBar && !isHolidayOrWeekend && !isSuspended)
                                ? proj.color + (isDraggingThis ? '99' : 'CC')
                                : isHolidayOrWeekend ? '#F9FAFB' : isToday ? '#FEFCE8' : 'white',
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
};

export default React.memo(ProjectBarRow);
