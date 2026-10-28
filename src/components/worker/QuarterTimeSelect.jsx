import React, { useState } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const QUARTER_MINUTES = ['00', '15', '30', '45'];

/**
 * 15分刻みの時刻選択（"HH:MM" 文字列を入出力）。
 * ネイティブの <input type="time" step="900"> は Chrome のピッカーに現在時刻の分が混ざるため、
 * 時・分の <select> 2つで置き換える。
 */
export default function QuarterTimeSelect({ value, onChange, label }) {
    const [valueHour = '', valueMinute = ''] = (value || '').split(':');
    // 分だけ先に選んだ場合は時が決まるまでここで保持する
    const [pendingMinute, setPendingMinute] = useState('');
    const minute = valueMinute || pendingMinute;
    // 15分刻み以外の既存データは消さずに選択肢へ残す
    const minuteOptions = valueMinute && !QUARTER_MINUTES.includes(valueMinute)
        ? [...QUARTER_MINUTES, valueMinute].sort()
        : QUARTER_MINUTES;

    const handleHour = (h) => {
        if (!h) {
            setPendingMinute('');
            onChange('');
            return;
        }
        onChange(`${h}:${minute || '00'}`);
        setPendingMinute('');
    };

    const handleMinute = (m) => {
        if (valueHour) onChange(`${valueHour}:${m}`);
        else setPendingMinute(m);
    };

    const selectClass = 'appearance-none bg-transparent text-center text-lg font-bold text-blue-600 outline-none cursor-pointer w-10';

    return (
        <div className="w-full h-12 flex items-center justify-center gap-0.5 bg-blue-50 border-2 border-blue-100 rounded-xl focus-within:border-blue-400 transition">
            <select value={valueHour} onChange={(e) => handleHour(e.target.value)}
                aria-label={`${label}（時）`} className={selectClass}>
                <option value="">--</option>
                {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span className="text-lg font-bold text-blue-600">:</span>
            <select value={minute} onChange={(e) => handleMinute(e.target.value)}
                aria-label={`${label}（分）`} className={selectClass}>
                <option value="" disabled>--</option>
                {minuteOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
        </div>
    );
}
