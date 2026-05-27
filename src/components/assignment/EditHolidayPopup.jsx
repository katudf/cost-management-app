import React from 'react';
import { X } from 'lucide-react';

const EditHolidayPopup = ({ editHolidayCell, onClose, onUpdateHoliday }) => {
    if (!editHolidayCell) return null;

    return (
        <div
            className="absolute z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-56 overflow-hidden"
            style={{
                top: `${editHolidayCell.top + 4}px`,
                left: `${Math.max(0, editHolidayCell.left - 50)}px`
            }}
        >
            <div className="bg-slate-700 text-white px-3 py-2 flex items-center justify-between">
                <div className="text-xs font-bold">
                    {editHolidayCell.dateStr.slice(5).replace('-', '/')} の予定
                </div>
                <button
                    onClick={onClose}
                    className="p-0.5 hover:bg-slate-600 rounded transition"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="p-2 flex flex-col gap-1">
                <button
                    onClick={() => onUpdateHoliday(editHolidayCell.dateStr, '休日', editHolidayCell.existingId)}
                    className="text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded font-bold"
                >
                    休日
                </button>
                <button
                    onClick={() => onUpdateHoliday(editHolidayCell.dateStr, '会議', editHolidayCell.existingId)}
                    className="text-left px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 rounded font-bold"
                >
                    会議
                </button>
                <button
                    onClick={() => onUpdateHoliday(editHolidayCell.dateStr, '社員旅行', editHolidayCell.existingId)}
                    className="text-left px-3 py-2 text-sm text-violet-700 hover:bg-violet-50 rounded font-bold"
                >
                    社員旅行
                </button>

                {editHolidayCell.existingId && (
                    <>
                        <div className="border-t border-slate-100 my-1"></div>
                        <button
                            onClick={() => onUpdateHoliday(editHolidayCell.dateStr, null, editHolidayCell.existingId)}
                            className="text-left px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded"
                        >
                            予定を解除 (通常営業日)
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default EditHolidayPopup;
