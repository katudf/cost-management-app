import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from './lib/supabase';
import { toDateStr, addDays, getDayOfWeek, getMonday } from './utils/dateUtils';
import { DEFAULT_COLORS, SCHEDULE_TYPES } from './utils/constants';


const ScheduleViewApp = () => {
    const [isLoading, setIsLoading] = useState(true);
    const [workers, setWorkers] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [barProjects, setBarProjects] = useState([]);

    // 表示期間: 2週間
    const [startDate, setStartDate] = useState(() => getMonday(new Date()));
    const totalDays = 14;

    const dateColumns = useMemo(() => {
        const cols = [];
        for (let i = 0; i < totalDays; i++) {
            const d = addDays(startDate, i);
            cols.push({
                date: d,
                dateStr: toDateStr(d),
                day: d.getDate(),
                month: d.getMonth() + 1,
                dow: d.getDay(),
                dowLabel: getDayOfWeek(d)
            });
        }
        return cols;
    }, [startDate]);

    const weekGroups = useMemo(() => {
        const groups = [];
        for (let i = 0; i < totalDays; i += 7) {
            const weekStart = dateColumns[i];
            groups.push({
                label: `${weekStart.month}/${weekStart.day}`,
                days: dateColumns.slice(i, i + 7)
            });
        }
        return groups;
    }, [dateColumns]);

    // データ取得
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const startStr = toDateStr(startDate);
            const endStr = toDateStr(addDays(startDate, totalDays - 1));

            const [aRes, pRes, wRes] = await Promise.all([
                supabase.from('Assignments').select('*').gte('date', startStr).lte('date', endStr),
                supabase.from('Projects').select('id, name, startDate, endDate, bar_color, status')
                    .not('startDate', 'is', null).not('endDate', 'is', null)
                    .order('created_at', { ascending: true }),
                supabase.from('Workers').select('id, name, display_order')
                    .order('display_order', { ascending: true, nullsFirst: false })
            ]);

            setAssignments(aRes.data || []);
            setBarProjects((pRes.data || []).map((p, idx) => ({
                ...p,
                color: p.bar_color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            })));
            setWorkers((wRes.data || []).filter(w => w.name && w.name.trim() !== ''));
        } catch (e) {
            console.error('データ取得エラー:', e);
        } finally {
            setIsLoading(false);
        }
    }, [startDate]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ルックアップ
    const assignmentLookup = useMemo(() => {
        const lookup = {};
        assignments.forEach(a => {
            const key = `${a.workerId}_${a.date}`;
            if (!lookup[key]) lookup[key] = [];
            lookup[key].push(a);
        });
        return lookup;
    }, [assignments]);

    const projectMap = useMemo(() => {
        const map = {};
        barProjects.forEach((p, idx) => {
            map[p.id] = {
                name: p.name || '無題',
                color: p.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
            };
        });
        return map;
    }, [barProjects]);

    const getDayBg = (dow) => {
        if (dow === 0) return { bg: '#FEE2E2', color: '#DC2626' };
        if (dow === 6) return { bg: '#DBEAFE', color: '#2563EB' };
        return { bg: undefined, color: '#334155' };
    };

    const isToday = (dateStr) => toDateStr(new Date()) === dateStr;

    const movePeriod = (weeks) => setStartDate(prev => addDays(prev, weeks * 7));
    const goToToday = () => setStartDate(getMonday(new Date()));

    const shortenName = (name) => {
        if (!name) return '';
        return name.length > 4 ? name.substring(0, 4) : name;
    };

    const periodLabel = `${startDate.getMonth() + 1}/${startDate.getDate()} 〜 ${addDays(startDate, totalDays - 1).getMonth() + 1}/${addDays(startDate, totalDays - 1).getDate()}`;

    if (isLoading && assignments.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-100">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-100 font-sans text-slate-900">
            {/* ヘッダー */}
            <header className="bg-blue-600 text-white px-4 py-3 shadow-md sticky top-0 z-40">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Calendar size={18} />
                        <span className="font-bold text-sm">配置予定表</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => movePeriod(-2)}
                            className="p-1.5 rounded-md hover:bg-blue-500 transition"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <button
                            onClick={goToToday}
                            className="px-2.5 py-1 text-[11px] font-bold bg-blue-500 rounded-md hover:bg-blue-400 transition"
                        >
                            今日
                        </button>
                        <span className="text-xs font-bold min-w-[100px] text-center">
                            {periodLabel}
                        </span>
                        <button
                            onClick={() => movePeriod(2)}
                            className="p-1.5 rounded-md hover:bg-blue-500 transition"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            </header>

            {isLoading && (
                <div className="h-1 bg-blue-200 overflow-hidden">
                    <div className="w-1/2 h-full bg-blue-500 animate-pulse"></div>
                </div>
            )}

            {/* テーブル */}
            <div className="overflow-x-auto">
                <table className="border-collapse w-max min-w-full" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: '72px', minWidth: '72px' }} />
                        {dateColumns.map((_, i) => (
                            <col key={i} style={{ width: '44px', minWidth: '44px' }} />
                        ))}
                    </colgroup>

                    {/* 日付ヘッダー */}
                    <thead>
                        <tr>
                            <th
                                className="sticky left-0 z-20 bg-slate-700 text-white text-[10px] font-bold p-1 border border-slate-600"
                                rowSpan={2}
                            >
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
                            {dateColumns.map((col, i) => {
                                const style = getDayBg(col.dow);
                                const today = isToday(col.dateStr);
                                return (
                                    <th
                                        key={i}
                                        className={`text-[10px] font-bold p-0.5 border border-slate-300 text-center ${today ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
                                        style={{
                                            backgroundColor: today ? '#BFDBFE' : style.bg || '#F8FAFC',
                                            color: style.color
                                        }}
                                    >
                                        <div className="leading-none">{col.day}</div>
                                        <div className="leading-none text-[9px]">{col.dowLabel}</div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    {/* 作業員配置 */}
                    <tbody>
                        {workers.map((worker, widx) => (
                            <tr key={worker.id} className={widx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                <td
                                    className="sticky left-0 z-10 text-[11px] font-bold p-1 border border-slate-200 truncate"
                                    style={{ backgroundColor: widx % 2 === 0 ? 'white' : '#F8FAFC' }}
                                    title={worker.name}
                                >
                                    {worker.name}
                                </td>
                                {dateColumns.map((col, i) => {
                                    const lookupKey = `${worker.id}_${col.dateStr}`;
                                    const cellAssigns = assignmentLookup[lookupKey] || [];
                                    const isWeekend = col.dow === 0 || col.dow === 6;
                                    const today = isToday(col.dateStr);

                                    return (
                                        <td
                                            key={i}
                                            className={`border border-slate-200 p-0 text-center align-middle ${today ? 'ring-1 ring-blue-400 ring-inset' : ''}`}
                                            style={{
                                                backgroundColor: today ? '#EFF6FF' : isWeekend ? '#F9FAFB' : undefined,
                                                overflow: 'hidden', maxWidth: 0, width: '44px'
                                            }}
                                        >
                                            {cellAssigns.length > 0 ? (
                                                <div className="flex flex-col gap-0.5 p-0.5" style={{ overflow: 'hidden' }}>
                                                    {cellAssigns.map((a, ai) => {
                                                        const pInfo = a.projectId ? projectMap[a.projectId] : null;
                                                        const schedType = !a.projectId && a.title
                                                            ? SCHEDULE_TYPES.find(s => s.title === a.title)
                                                            : null;
                                                        const displayName = a.title || shortenName(pInfo?.name || '');
                                                        const bgColor = schedType?.color || pInfo?.color || '#94A3B8';
                                                        return (
                                                            <div
                                                                key={ai}
                                                                className="text-[8px] font-bold rounded px-0.5 py-0.5 text-white truncate"
                                                                style={{
                                                                    backgroundColor: bgColor,
                                                                    textShadow: '0 1px 1px rgba(0,0,0,0.3)'
                                                                }}
                                                                title={pInfo?.name || a.title || ''}
                                                            >
                                                                {displayName}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="h-5"></div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>


        </div>
    );
};

export default ScheduleViewApp;
