import React from 'react';
import { SCHEDULE_TYPES } from '../../utils/constants';

const shortenName = (name) => {
    if (!name) return '';
    return name.length > 6 ? name.substring(0, 6) : name;
};

/**
 * 作業員配置表の1行。
 * React.memo でメモ化し、ドラッグ選択中は対象行のみ再レンダリングされるよう
 * editCell / dragCells は「この行の作業員に関するもののみ」親から渡される
 * （rowEditCell / rowDragCells）。
 */
const WorkerRow = ({
    worker,
    widx,
    dateColumns,
    assignmentLookup,
    taskRecordLookup,
    projectMap,
    todayStr,
    rowEditCell,    // この行の作業員のeditCellのみ（それ以外はnull）
    rowDragCells,   // この行の作業員のドラッグ選択のみ（それ以外は空配列）
    isRowDragging,  // この行でドラッグ選択中か
    onCellMouseDown,
    onCellMouseEnter,
    onCellClick,
    onDropProject   // (workerId, dateStr, projectId) => void
}) => {
    return (
        <tr className={`${widx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50 transition-colors`}>
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
                const isToday = col.dateStr === todayStr;
                const isEditing = rowEditCell && (
                    rowEditCell.dragDates ? rowEditCell.dragDates.includes(col.dateStr) : rowEditCell.dateStr === col.dateStr
                );
                const isDragSelected = isRowDragging && rowDragCells.includes(col.dateStr);

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
                            backgroundColor: isDragSelected ? '#DBEAFE' : isEditing ? '#EFF6FF' : isWeekend ? '#F9FAFB' : isToday ? '#FEFCE8' : undefined,
                            overflow: 'hidden', maxWidth: 0, width: '48px'
                        }}
                        onMouseDown={(e) => onCellMouseDown(e, worker.id, col.dateStr)}
                        onMouseEnter={() => onCellMouseEnter(worker.id, col.dateStr)}
                        onClick={(e) => {
                            if (!isRowDragging && rowDragCells.length <= 1) {
                                onCellClick(e, worker.id, col.dateStr);
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
                                onDropProject(worker.id, col.dateStr, Number(projectId));
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
    );
};

export default React.memo(WorkerRow);
