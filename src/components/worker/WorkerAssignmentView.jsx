import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { SCHEDULE_TYPES } from '../../utils/constants';
import { useWorkerAssignments } from '../../hooks/useWorkerAssignments';

const CELL_WIDTH = 90;      // 現場名をできるだけ長く表示するため広めに取る（管理者版は48px）
const NAME_COL_WIDTH = 72;

// セル内チップ（現場名2行折り返し・実績はストライプ）
const AssignmentChip = ({ item }) => (
    <div
        className={`text-[10px] font-bold rounded px-1 py-0.5 text-black leading-tight ${item.isActual ? 'shadow-sm border border-black/20' : ''}`}
        style={{
            background: item.isActual
                ? `repeating-linear-gradient(-45deg, rgba(255,255,255,0.2), rgba(255,255,255,0.2) 3px, transparent 3px, transparent 6px), ${item.bgColor}`
                : item.bgColor,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-all',
        }}
    >
        {item.displayName}
    </div>
);

/**
 * 作業員アプリ用の配置表（全画面・閲覧専用）。
 * 管理者版の作業員エリアのみを表示し、編集機能は持たない。
 */
const WorkerAssignmentView = ({ workers, projects, loggedInWorker, onClose }) => {
    const {
        isLoading,
        todayStr,
        dateColumns,
        weekGroups,
        holidayMap,
        projectMap,
        assignmentLookup,
        taskRecordLookup,
        displayWorkers,
    } = useWorkerAssignments({ workers, projects, loggedInWorker });

    // セルタップ時の詳細ポップアップ { workerName, dateLabel, items }
    const [detail, setDetail] = useState(null);
    const scrollRef = useRef(null);

    // 初期表示時に本日の列へ横スクロール（前日を1列分残す）
    useEffect(() => {
        if (isLoading || !scrollRef.current) return;
        const todayIdx = dateColumns.findIndex(c => c.dateStr === todayStr);
        if (todayIdx > 0) {
            scrollRef.current.scrollLeft = Math.max(0, (todayIdx - 1) * CELL_WIDTH);
        }
    }, [isLoading, dateColumns, todayStr]);

    // 会議・社員旅行は休日扱いにしない（管理者版と同じ判定）
    const isActualHoliday = (col) => {
        if (col.dow === 0) return true;
        const h = holidayMap[col.dateStr];
        return !!(h && h.description !== '会議' && h.description !== '社員旅行');
    };

    // セルの表示アイテムを組み立てる（過去日は日報実績を優先、管理者版と同じルール）
    const buildCellItems = (workerId, col) => {
        const lookupKey = `${workerId}_${col.dateStr}`;
        const isPastDate = col.dateStr <= todayStr;
        const actualProjectIds = isPastDate ? (taskRecordLookup[lookupKey] || []) : [];
        if (isPastDate && actualProjectIds.length > 0) {
            return actualProjectIds.map(pid => {
                const pInfo = projectMap[pid];
                return {
                    key: `actual-${pid}`,
                    displayName: pInfo?.name || '不明',
                    fullName: pInfo?.name || '不明',
                    bgColor: pInfo?.color || '#94A3B8',
                    isActual: true,
                };
            });
        }
        return (assignmentLookup[lookupKey] || []).map((a, ai) => {
            const pInfo = a.projectId ? projectMap[a.projectId] : null;
            const schedType = !a.projectId && a.title ? SCHEDULE_TYPES.find(s => s.title === a.title) : null;
            return {
                key: ai,
                displayName: a.title || pInfo?.name || '',
                fullName: pInfo?.name || a.title || '',
                bgColor: schedType?.color || pInfo?.color || '#94A3B8',
                isActual: false,
            };
        });
    };

    const handleCellTap = (worker, col, items) => {
        if (items.length === 0) return;
        setDetail({
            workerName: worker.name,
            dateLabel: `${col.month}/${col.day}（${col.dowLabel}）`,
            items,
        });
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col">
            <header className="bg-blue-600 text-white p-3 shadow-md flex items-center gap-3 shrink-0">
                <button
                    onClick={onClose}
                    aria-label="日報入力に戻る"
                    title="日報入力に戻る"
                    className="flex items-center gap-1 bg-blue-700 hover:bg-blue-800 px-3 py-1.5 rounded-lg text-sm font-bold transition"
                >
                    <ArrowLeft size={16} /> 戻る
                </button>
                <div className="flex flex-col leading-tight">
                    <span className="font-bold text-lg">配置表</span>
                    {dateColumns.length > 0 && (
                        <span className="text-[11px] text-blue-100">
                            {dateColumns[0].month}/{dateColumns[0].day} 〜 {dateColumns[dateColumns.length - 1].month}/{dateColumns[dateColumns.length - 1].day}（閲覧のみ）
                        </span>
                    )}
                </div>
            </header>

            <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-b border-slate-200 text-[10px] font-bold text-slate-500 shrink-0">
                <span className="flex items-center gap-1">
                    <span
                        className="inline-block w-4 h-3 rounded border border-black/20"
                        style={{ background: 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.2), rgba(255,255,255,0.2) 3px, transparent 3px, transparent 6px), #94A3B8' }}
                    ></span>
                    日報実績
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ backgroundColor: '#FEFCE8' }}></span>
                    本日
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-4 h-3 rounded border border-slate-300" style={{ backgroundColor: '#DBEAFE' }}></span>
                    自分
                </span>
            </div>

            {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                </div>
            ) : (
                <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain">
                    <table className="border-collapse" style={{ tableLayout: 'fixed', width: NAME_COL_WIDTH + dateColumns.length * CELL_WIDTH }}>
                        <colgroup>
                            <col style={{ width: NAME_COL_WIDTH }} />
                            {dateColumns.map((col) => <col key={col.dateStr} style={{ width: CELL_WIDTH }} />)}
                        </colgroup>
                        <thead>
                            <tr>
                                <th
                                    className="sticky left-0 top-0 z-30 bg-slate-700 text-white text-xs font-bold p-2 border border-slate-600"
                                    rowSpan={2}
                                >
                                    作業員
                                </th>
                                {weekGroups.map((wg, wi) => (
                                    <th
                                        key={wi}
                                        colSpan={wg.days.length}
                                        className="sticky top-0 z-20 bg-slate-700 text-white text-[10px] font-bold p-1 border border-slate-600 text-center"
                                        style={{ height: 24 }}
                                    >
                                        {wg.label}〜
                                    </th>
                                ))}
                            </tr>
                            <tr>
                                {dateColumns.map((col) => {
                                    const holiday = isActualHoliday(col);
                                    const isToday = col.dateStr === todayStr;
                                    let bg = '#F8FAFC';
                                    let color;
                                    if (holiday) { bg = '#FEE2E2'; color = '#DC2626'; }
                                    else if (col.dow === 6) { bg = '#DBEAFE'; color = '#2563EB'; }
                                    return (
                                        <th
                                            key={col.dateStr}
                                            className="sticky z-20 text-[10px] font-bold p-1 border border-slate-200 text-center"
                                            style={{
                                                top: 24,
                                                backgroundColor: isToday ? '#2563EB' : bg,
                                                color: isToday ? 'white' : color,
                                            }}
                                        >
                                            <div>{col.day}</div>
                                            <div style={{ color: isToday ? '#BFDBFE' : (color || '#64748B') }}>{col.dowLabel}</div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td
                                    className="sticky left-0 z-10 bg-slate-100 text-[10px] font-bold p-1 border border-slate-200 text-slate-600"
                                >
                                    行事/休日
                                </td>
                                {dateColumns.map((col) => {
                                    const holidayObj = holidayMap[col.dateStr];
                                    let bgColor = 'transparent';
                                    if (holidayObj) {
                                        bgColor = holidayObj.description === '会議' ? '#BAE6FD'
                                            : holidayObj.description === '社員旅行' ? '#DDD6FE'
                                                : '#FECACA';
                                    }
                                    return (
                                        <td
                                            key={col.dateStr}
                                            className="border border-slate-200 p-0.5 text-center text-[9px] font-bold text-slate-700 truncate"
                                            style={{ backgroundColor: bgColor, overflow: 'hidden' }}
                                            title={holidayObj?.description || ''}
                                        >
                                            {holidayObj?.description || ''}
                                        </td>
                                    );
                                })}
                            </tr>
                            {displayWorkers.map((worker, widx) => {
                                const isSelf = loggedInWorker && worker.id === loggedInWorker.id;
                                const rowBg = isSelf ? '#DBEAFE' : (widx % 2 === 0 ? 'white' : '#F8FAFC');
                                return (
                                    <tr key={worker.id}>
                                        <td
                                            className={`sticky left-0 z-10 text-xs font-bold p-1.5 border border-slate-200 truncate ${isSelf ? 'text-blue-700' : ''}`}
                                            style={{ backgroundColor: rowBg }}
                                            title={worker.name}
                                        >
                                            {worker.name}
                                        </td>
                                        {dateColumns.map((col) => {
                                            const items = buildCellItems(worker.id, col);
                                            const isToday = col.dateStr === todayStr;
                                            const isWeekend = col.dow === 0 || col.dow === 6;
                                            const holiday = isActualHoliday(col);
                                            let cellBg;
                                            if (isToday) cellBg = '#FEFCE8';
                                            else if (holiday) cellBg = '#FEF2F2';
                                            else if (isWeekend) cellBg = '#F9FAFB';
                                            else if (isSelf) cellBg = '#EFF6FF';
                                            return (
                                                <td
                                                    key={col.dateStr}
                                                    className="border border-slate-200 p-0 align-middle"
                                                    style={{ backgroundColor: cellBg, overflow: 'hidden' }}
                                                    onClick={() => handleCellTap(worker, col, items)}
                                                >
                                                    {items.length > 0 ? (
                                                        <div className="flex flex-col gap-0.5 p-0.5" style={{ overflow: 'hidden' }}>
                                                            {items.map((item) => <AssignmentChip key={item.key} item={item} />)}
                                                        </div>
                                                    ) : (
                                                        <div className="h-8"></div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* セル詳細ポップアップ（閲覧専用） */}
            {detail && (
                <div
                    className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-6"
                    onClick={() => setDetail(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="font-bold text-slate-800">
                                {detail.dateLabel}<span className="ml-2 text-sm text-slate-500">{detail.workerName}</span>
                            </div>
                            <button
                                onClick={() => setDetail(null)}
                                aria-label="閉じる"
                                title="閉じる"
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-2">
                            {detail.items.map((item) => (
                                <div key={item.key} className="flex items-start gap-2">
                                    <span
                                        className="inline-block w-4 h-4 rounded mt-0.5 shrink-0 border border-black/10"
                                        style={{ backgroundColor: item.bgColor }}
                                    ></span>
                                    <span className="text-sm font-bold text-slate-800 break-all">
                                        {item.fullName}
                                        {item.isActual && <span className="ml-1 text-[10px] font-bold text-slate-500">（日報実績）</span>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkerAssignmentView;
