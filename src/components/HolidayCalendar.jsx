import React, { useState, useEffect, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const HOLIDAY_TYPES = [
    { key: 'holiday', label: '休日', color: '#FECACA', textColor: '#DC2626', description: null },
    { key: 'meeting', label: '会議', color: '#BAE6FD', textColor: '#0369A1', description: '会議' },
    { key: 'trip', label: '社員旅行', color: '#DDD6FE', textColor: '#6D28D9', description: '社員旅行' },
];

const HolidayCalendar = () => {
    const { showToast } = useToast();
    const [year, setYear] = useState(new Date().getFullYear());
    const [holidays, setHolidays] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeType, setActiveType] = useState('holiday');

    const fetchHolidays = useCallback(async () => {
        setIsLoading(true);
        try {
            const startDate = `${year}-01-01`;
            const endDate = `${year}-12-31`;
            const { data, error } = await supabase
                .from('CompanyHolidays')
                .select('*')
                .gte('date', startDate)
                .lte('date', endDate);
            if (error) throw error;
            setHolidays(data || []);
        } catch (err) {
            console.error('休日データ取得エラー:', err);
            showToast('休日データの取得に失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [year, showToast]);

    useEffect(() => {
        fetchHolidays();
    }, [fetchHolidays]);

    const getHoliday = (dateStr) => holidays.find(h => h.date === dateStr);

    const toggleDate = async (dateStr) => {
        const existing = getHoliday(dateStr);
        const typeInfo = HOLIDAY_TYPES.find(t => t.key === activeType);

        try {
            if (existing) {
                // 同じタイプなら削除、違うタイプなら切り替え
                const existingDesc = existing.description || null;
                const newDesc = typeInfo.description;
                if (existingDesc === newDesc) {
                    // 削除
                    const { error } = await supabase.from('CompanyHolidays').delete().eq('id', existing.id);
                    if (error) throw error;
                    setHolidays(prev => prev.filter(h => h.id !== existing.id));
                } else {
                    // タイプ変更
                    const { data, error } = await supabase
                        .from('CompanyHolidays')
                        .update({ description: newDesc })
                        .eq('id', existing.id)
                        .select();
                    if (error) throw error;
                    if (data && data[0]) setHolidays(prev => prev.map(h => h.id === existing.id ? data[0] : h));
                }
            } else {
                // 新規追加
                const { data, error } = await supabase
                    .from('CompanyHolidays')
                    .insert([{ date: dateStr, description: typeInfo.description }])
                    .select();
                if (error) throw error;
                if (data && data[0]) setHolidays(prev => [...prev, data[0]]);
            }
        } catch (err) {
            console.error('休日更新エラー:', err);
            showToast('休日の更新に失敗しました', 'error');
        }
    };

    const getDateColor = (dateStr, dow) => {
        const h = getHoliday(dateStr);
        if (h) {
            const type = HOLIDAY_TYPES.find(t => t.description === (h.description || null));
            return type || HOLIDAY_TYPES[0];
        }
        if (dow === 0) return { color: '#FEF2F2', textColor: '#DC2626' };
        if (dow === 6) return { color: '#EFF6FF', textColor: '#2563EB' };
        return null;
    };

    const renderMonth = (month) => {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDow = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        const cells = [];
        // 空白セル
        for (let i = 0; i < startDow; i++) {
            cells.push(<td key={`empty-${i}`} className="p-0"></td>);
        }
        // 日付セル
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dow = date.getDay();
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const colorInfo = getDateColor(dateStr, dow);
            const holiday = getHoliday(dateStr);

            cells.push(
                <td
                    key={day}
                    onClick={() => toggleDate(dateStr)}
                    className="p-0 text-center cursor-pointer transition-all hover:scale-110 hover:shadow-md relative"
                    style={{
                        backgroundColor: holiday ? (HOLIDAY_TYPES.find(t => t.description === (holiday.description || null))?.color || '#FECACA') : (colorInfo?.color || 'transparent'),
                        borderRadius: '4px',
                    }}
                    title={holiday ? `${dateStr} - ${holiday.description || '休日'}（クリックで解除）` : `${dateStr}（クリックで設定）`}
                >
                    <div
                        className="w-8 h-8 flex items-center justify-center text-xs font-bold mx-auto"
                        style={{
                            color: holiday ? (HOLIDAY_TYPES.find(t => t.description === (holiday.description || null))?.textColor || '#DC2626') : (colorInfo?.textColor || '#334155'),
                        }}
                    >
                        {day}
                    </div>
                </td>
            );
        }

        // 行に分割
        const rows = [];
        for (let i = 0; i < cells.length; i += 7) {
            rows.push(
                <tr key={`row-${i}`}>
                    {cells.slice(i, i + 7).map((cell, idx) => cell || <td key={`pad-${idx}`} className="p-0"></td>)}
                    {/* 最後の行が7未満の場合にパディング */}
                    {i + 7 > cells.length && Array.from({ length: 7 - (cells.length - i) }).map((_, idx) => (
                        <td key={`tail-${idx}`} className="p-0"></td>
                    ))}
                </tr>
            );
        }

        const holidayCount = holidays.filter(h => {
            const d = new Date(h.date);
            return d.getFullYear() === year && d.getMonth() === month;
        }).length;

        return (
            <div key={month} className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-slate-700">{MONTH_NAMES[month]}</h4>
                    {holidayCount > 0 && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">
                            {holidayCount}日
                        </span>
                    )}
                </div>
                <table className="w-full border-collapse">
                    <thead>
                        <tr>
                            {DOW_LABELS.map((d, i) => (
                                <th
                                    key={i}
                                    className="text-[10px] font-bold p-0.5 text-center"
                                    style={{ color: i === 0 ? '#DC2626' : i === 6 ? '#2563EB' : '#94A3B8' }}
                                >
                                    {d}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>{rows}</tbody>
                </table>
            </div>
        );
    };

    const totalHolidays = holidays.length;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-6xl mt-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <CalendarDays className="text-red-500" />
                    会社休日カレンダー
                </h3>
                <div className="flex items-center gap-3">
                    {/* 年選択 */}
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                        <button
                            onClick={() => setYear(y => y - 1)}
                            className="p-1.5 rounded-md hover:bg-white text-slate-500 transition shadow-sm"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="text-sm font-bold text-slate-700 min-w-[60px] text-center">{year}年</span>
                        <button
                            onClick={() => setYear(y => y + 1)}
                            className="p-1.5 rounded-md hover:bg-white text-slate-500 transition shadow-sm"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <span className="text-xs text-slate-500 font-bold bg-slate-100 px-3 py-1.5 rounded-lg">
                        設定済: {totalHolidays}日
                    </span>
                </div>
            </div>

            {/* タイプ選択 */}
            <div className="flex items-center gap-2 mb-4 bg-slate-50 rounded-lg p-3 border border-slate-100">
                <span className="text-xs font-bold text-slate-500 mr-2">クリック時の設定:</span>
                {HOLIDAY_TYPES.map(type => (
                    <button
                        key={type.key}
                        onClick={() => setActiveType(type.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                            activeType === type.key
                                ? 'ring-2 ring-offset-1 shadow-sm'
                                : 'opacity-60 hover:opacity-100'
                        }`}
                        style={{
                            backgroundColor: type.color,
                            color: type.textColor,
                            borderColor: activeType === type.key ? type.textColor : 'transparent',
                            ringColor: type.textColor,
                        }}
                    >
                        {type.label}
                    </button>
                ))}
                <span className="text-[10px] text-slate-400 ml-2">※同じ種別のクリックで解除</span>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                    {Array.from({ length: 12 }).map((_, i) => renderMonth(i))}
                </div>
            )}

            {/* 凡例 */}
            <div className="mt-4 flex items-center gap-4 text-[11px] text-slate-500 border-t border-slate-100 pt-3">
                <span className="font-bold">凡例:</span>
                {HOLIDAY_TYPES.map(type => (
                    <div key={type.key} className="flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: type.color, border: `1px solid ${type.textColor}40` }}></div>
                        <span>{type.label}</span>
                    </div>
                ))}
                <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: '#EFF6FF', border: '1px solid #2563EB40' }}></div>
                    <span>土曜</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: '#FEF2F2', border: '1px solid #DC262640' }}></div>
                    <span>日曜</span>
                </div>
            </div>
        </div>
    );
};

export default React.memo(HolidayCalendar);
