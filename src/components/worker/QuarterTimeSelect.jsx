import React, { useState } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
export const QUARTER_MINUTES = ['00', '15', '30', '45'];

/**
 * 分の選択肢。15分刻み以外の既存データ（現在値・初期値）は消さずに選択肢へ残す。
 */
export function minuteOptionsFor(...minutes) {
    const extra = minutes.filter(m => m && !QUARTER_MINUTES.includes(m));
    return [...new Set([...QUARTER_MINUTES, ...extra])].sort();
}

/**
 * 15分刻みの時刻選択（"HH:MM" 文字列を入出力）。
 * ネイティブの <input type="time" step="900"> は Chrome のピッカーに現在時刻の分が混ざるため、
 * 時・分の <select> 2つで置き換える。分は時を選ぶまで選択不可（時を選ぶと分は 00 で始まる）。
 */
export default function QuarterTimeSelect({ value, onChange, label }) {
    const [hour = '', minute = ''] = (value || '').split(':');
    // 初期値の半端な分は、一度別の分に変えても選び直せるよう保持する
    const [initialMinute] = useState(minute);
    const minuteOptions = minuteOptionsFor(minute, initialMinute);

    const handleHour = (h) => onChange(h ? `${h}:${minute || '00'}` : '');

    const selectClass = 'appearance-none bg-transparent text-center text-lg font-bold text-blue-600 outline-none cursor-pointer w-10 disabled:cursor-not-allowed disabled:text-slate-300';

    return (
        <div className="w-full h-12 flex items-center justify-center gap-0.5 bg-blue-50 border-2 border-blue-100 rounded-xl focus-within:border-blue-400 transition">
            <select value={hour} onChange={(e) => handleHour(e.target.value)}
                aria-label={`${label}（時）`} className={selectClass}>
                <option value="">--</option>
                {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span className="text-lg font-bold text-blue-600">:</span>
            <select value={minute} onChange={(e) => onChange(`${hour}:${e.target.value}`)}
                disabled={!hour} aria-label={`${label}（分）`} className={selectClass}>
                {!hour && <option value="">--</option>}
                {minuteOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
        </div>
    );
}
