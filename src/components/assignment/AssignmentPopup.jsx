import React from 'react';
import { X, Trash2, ExternalLink } from 'lucide-react';
import { SCHEDULE_TYPES } from '../../utils/constants';

const AssignmentPopup = React.forwardRef(({
    editCell,
    onClose,
    workers,
    projectMap,
    allProjects,
    editCellAssignments,
    unassignedProjects,
    clipboard,
    handleAssignmentReorder,
    removeAssignment,
    handlePopupAssign,
    handleActionCopy,
    handleActionCut,
    handleActionPaste,
    handleActionDelete,
    setActiveProjectId,
    setActiveTab
}, ref) => {
    if (!editCell) return null;

    const workerName = workers.find(w => w.id === editCell.workerId)?.name || '';

    return (
        <div
            ref={ref}
            className={`absolute z-50 flex gap-2 ${editCell.showAbove ? 'flex-col-reverse' : 'flex-col'}`}
            style={{
                top: `${editCell.showAbove ? editCell.top - 4 : editCell.top + 4}px`,
                left: `${Math.max(0, editCell.left - 100)}px`,
                transform: editCell.showAbove ? 'translateY(-100%)' : 'none'
            }}
        >
            {/* メイン編集ポップアップ */}
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-64 overflow-hidden">
                {/* ヘッダー */}
                <div className="bg-slate-700 text-white px-3 py-2 flex items-center justify-between">
                    <div className="text-xs font-bold">
                        {workerName} ー {
                            editCell.dragDates && editCell.dragDates.length > 1
                                ? `${editCell.dragDates[0].slice(5).replace('-', '/')} 〜 ${editCell.dragDates[editCell.dragDates.length - 1].slice(5).replace('-', '/')} (${editCell.dragDates.length}日)`
                                : editCell.dateStr.slice(5).replace('-', '/')
                        }
                    </div>
                    <button
                        onClick={onClose}
                        className="p-0.5 hover:bg-slate-600 rounded transition"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* 現在の配置（単一セルの場合のみ） */}
                {(!editCell.dragDates || editCell.dragDates.length <= 1) && editCellAssignments.length > 0 && (
                    <div className="px-3 py-2 border-b border-slate-100">
                        <div className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase">現在の配置</div>
                        <div className="space-y-1">
                            {editCellAssignments.map((a) => {
                                const pInfo = a.projectId ? projectMap[a.projectId] : null;
                                const schedType = !a.projectId && a.title ? SCHEDULE_TYPES.find(s => s.title === a.title) : null;
                                const itemColor = schedType?.color || pInfo?.color || '#94A3B8';
                                const itemName = schedType ? `${schedType.icon} ${schedType.title}` : (pInfo?.name || '不明');
                                return (
                                    <div
                                        key={a.id}
                                        className="flex items-center justify-between gap-2 p-1.5 rounded-lg border border-transparent hover:border-blue-200 cursor-grab active:cursor-grabbing transition"
                                        style={{ backgroundColor: itemColor + '20' }}
                                        draggable={true}
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('assignmentid', a.id.toString());
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
                                            const draggedAssignmentId = e.dataTransfer.getData('assignmentid');
                                            if (draggedAssignmentId) {
                                                handleAssignmentReorder(parseInt(draggedAssignmentId, 10), a.id);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <div
                                                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                                style={{ backgroundColor: itemColor }}
                                            ></div>
                                            <span className="text-xs font-bold text-slate-700 truncate">
                                                {itemName}
                                            </span>
                                            {a.projectId && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (setActiveProjectId && setActiveTab) {
                                                            setActiveProjectId(a.projectId);
                                                            setActiveTab('master');
                                                        }
                                                    }}
                                                    className="text-slate-400 hover:text-blue-600 p-0.5 rounded hover:bg-blue-50 transition"
                                                    title="現場の詳細設定を開く"
                                                >
                                                    <ExternalLink size={12} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeAssignment(a.id);
                                                }}
                                                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition ml-1"
                                                title="配置を解除"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 現場の追加 */}
                {unassignedProjects.length > 0 && (
                    <div className="px-3 py-2 border-b border-slate-100 max-h-48 overflow-y-auto custom-scrollbar">
                        <div className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase">現場の追加</div>
                        <div className="flex flex-col gap-1">
                            {unassignedProjects.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => { handlePopupAssign(p.id, null); }}
                                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:opacity-80 transition text-left"
                                    style={{ backgroundColor: p.color + '20', border: `1px solid ${p.color}40` }}
                                >
                                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }}></div>
                                    <span className="text-[11px] font-bold text-slate-700 truncate">{p.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* スケジュール種別 */}
                <div className="px-3 py-2">
                    <div className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase">その他</div>
                    <div className="flex flex-wrap gap-1">
                        {SCHEDULE_TYPES
                            .filter(s => !editCellAssignments.some(a => a.title === s.title))
                            .map(s => (
                                <button
                                    key={s.title}
                                    onClick={() => { handlePopupAssign(null, s.title); }}
                                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:opacity-80 transition text-left"
                                    style={{ backgroundColor: s.color + '20', border: `1px solid ${s.color}40` }}
                                >
                                    <span className="text-xs">{s.icon}</span>
                                    <span className="text-[10px] font-bold" style={{ color: s.color }}>
                                        {s.title}
                                    </span>
                                </button>
                            ))}
                    </div>
                </div>
            </div>

            {/* 分離されたショートカットヒント兼アクションボタン */}
            <div className="bg-slate-800/95 backdrop-blur-sm text-slate-200 px-3 py-2 rounded-lg shadow-lg border border-slate-700 text-[10px] flex gap-4 justify-between min-w-[200px]">
                <div className="flex gap-2">
                    <div className="flex flex-col gap-1 items-center">
                        <span className="text-slate-400">コピー:</span>
                        <button onClick={handleActionCopy} className="font-mono text-[9px] bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 hover:bg-slate-700 hover:text-white transition cursor-pointer">Ctrl+C</button>
                    </div>
                    <div className="flex flex-col gap-1 items-center">
                        <span className="text-slate-400">カット:</span>
                        <button onClick={handleActionCut} className="font-mono text-[9px] bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 hover:bg-slate-700 hover:text-white transition cursor-pointer">Ctrl+X</button>
                    </div>
                    <div className="flex flex-col gap-1 items-center">
                        <span className="text-slate-400">ペースト:</span>
                        <button onClick={handleActionPaste} className={`font-mono text-[9px] bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 transition ${clipboard?.data?.length > 0 ? 'hover:bg-slate-700 hover:text-white cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>Ctrl+V</button>
                    </div>
                </div>
                <div className="flex flex-col gap-1 items-center border-l border-slate-600 pl-4">
                    <span className="text-slate-400">一括削除:</span>
                    <button onClick={handleActionDelete} className="font-mono text-[9px] bg-red-900/50 text-red-200 border border-red-800 rounded px-1.5 py-0.5 hover:bg-red-800 hover:text-white transition cursor-pointer">Delete</button>
                </div>
            </div>
        </div>
    );
});

export default AssignmentPopup;
