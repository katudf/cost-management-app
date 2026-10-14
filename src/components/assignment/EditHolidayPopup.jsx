import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
    COMPANY_EVENT,
    HOLIDAY_DESCRIPTION,
    FREE_TEXT_EVENT_MAX_LENGTH,
    isFreeTextEvent,
} from '../../utils/holidayUtils';

const EditHolidayPopup = ({ editHolidayCell, onClose, onUpdateHoliday }) => {
    if (!editHolidayCell) return null;
    // 開くセルが変わったら入力欄を初期化するため key で再マウントする
    return (
        <EditHolidayPopupBody
            key={editHolidayCell.dateStr}
            editHolidayCell={editHolidayCell}
            onClose={onClose}
            onUpdateHoliday={onUpdateHoliday}
        />
    );
};

const EditHolidayPopupBody = ({ editHolidayCell, onClose, onUpdateHoliday }) => {
    const { dateStr, existingId, existingDescription } = editHolidayCell;
    const [freeText, setFreeText] = useState(
        isFreeTextEvent({ description: existingDescription }) ? existingDescription : ''
    );
    const trimmed = freeText.trim();

    const submitFreeText = () => {
        if (!trimmed) return;
        onUpdateHoliday(dateStr, trimmed, existingId);
    };

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
                    {dateStr.slice(5).replace('-', '/')} の予定
                </div>
                <button
                    onClick={onClose}
                    aria-label="閉じる"
                    title="閉じる"
                    className="p-0.5 hover:bg-slate-600 rounded transition"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="p-2 flex flex-col gap-1">
                <button
                    onClick={() => onUpdateHoliday(dateStr, HOLIDAY_DESCRIPTION, existingId)}
                    className="text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded font-bold"
                >
                    休日
                </button>
                <button
                    onClick={() => onUpdateHoliday(dateStr, COMPANY_EVENT.MEETING, existingId)}
                    className="text-left px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 rounded font-bold"
                >
                    会議
                </button>

                <div className="border-t border-slate-100 my-1"></div>
                <form
                    onSubmit={(e) => { e.preventDefault(); submitFreeText(); }}
                    className="px-1 flex flex-col gap-1"
                >
                    <label className="text-[11px] font-bold text-amber-800">
                        自由記入
                    </label>
                    <div className="flex gap-1">
                        <input
                            type="text"
                            value={freeText}
                            onChange={(e) => setFreeText(e.target.value)}
                            maxLength={FREE_TEXT_EVENT_MAX_LENGTH}
                            placeholder="例: 安全大会"
                            aria-label="自由記入の予定"
                            className="flex-1 min-w-0 border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                        />
                        <button
                            type="submit"
                            disabled={!trimmed}
                            className="px-2 py-1 text-xs font-bold rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            登録
                        </button>
                    </div>
                </form>

                {existingId && (
                    <>
                        <div className="border-t border-slate-100 my-1"></div>
                        <button
                            onClick={() => onUpdateHoliday(dateStr, null, existingId)}
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
