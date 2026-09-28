import React, { useState, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Loader2, LinkIcon } from 'lucide-react';
import { toDateStr, addDays, getMonday, buildDateColumns, buildWeekGroups } from './utils/dateUtils';
import { DEFAULT_COLORS, SCHEDULE_TYPES, PROJECT_STATUS } from './utils/constants';
import { useAuth } from './hooks/useAuth';
import { useScheduleViewData } from './hooks/useScheduleViewData';
import { isNonWorkingDay } from './utils/holidayUtils';
import LoginScreen from './components/auth/LoginScreen';
import ResetPasswordScreen from './components/auth/ResetPasswordScreen';


// メイン配置表と同様、有給用の案件はバーに出さない
const EXCLUDED_BAR_NAMES = ['【会社】有給', '有給', '【有給】'];

// 共有キー付きURL（?mode=schedule&key=xxxx）ならログイン不要で閲覧できる
const getShareKey = () => {
    const key = new URLSearchParams(window.location.search).get('key');
    return key && key.trim() !== '' ? key.trim() : null;
};

const ScheduleViewApp = () => {
    const { isAuthenticated, isLoading: isAuthLoading, isPasswordRecovery } = useAuth();
    const [shareKey] = useState(getShareKey);

    // 表示期間: 2週間
    const [startDate, setStartDate] = useState(() => getMonday(new Date()));
    const totalDays = 14;

    const { workers, assignments, barProjects, holidays, isLoading, error } = useScheduleViewData(startDate, totalDays, shareKey);

    // isOff: 日曜または登録休日（メイン配置表と同じ判定）
    const dateColumns = useMemo(() => {
        const holidayMap = {};
        holidays.forEach(h => { holidayMap[h.date] = h; });
        return buildDateColumns(startDate, totalDays).map(col => ({
            ...col,
            isOff: isNonWorkingDay(col.dow, holidayMap[col.dateStr]),
        }));
    }, [startDate, totalDays, holidays]);
    const weekGroups = useMemo(() => buildWeekGroups(dateColumns), [dateColumns]);

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

    // 上部バーチャート: メイン配置表と同じく予定・施工中の案件のみ、表示期間に掛かるものを表示
    const visibleBars = useMemo(() => {
        const viewEnd = addDays(startDate, totalDays - 1);
        return barProjects
            .filter(p => [PROJECT_STATUS.SCHEDULED, PROJECT_STATUS.IN_PROGRESS].includes(p.status)
                && !EXCLUDED_BAR_NAMES.includes(p.name))
            .map(p => {
                const pStart = new Date(p.startDate + 'T00:00:00');
                const pEnd = new Date(p.endDate + 'T00:00:00');
                if (pEnd < startDate || pStart > viewEnd) return null;
                const startIdx = Math.max(0, Math.round((pStart - startDate) / 86400000));
                const endIdx = Math.min(totalDays - 1, Math.round((pEnd - startDate) / 86400000));
                return { ...p, startIdx, endIdx };
            })
            .filter(Boolean);
    }, [barProjects, startDate, totalDays]);

    const getDayBg = ({ dow, isOff }) => {
        if (isOff) return { bg: '#FEE2E2', color: '#DC2626' };
        if (dow === 6) return { bg: '#DBEAFE', color: '#2563EB' };
        return { bg: undefined, color: '#334155' };
    };

    const isToday = (dateStr) => toDateStr(new Date()) === dateStr;

    const movePeriod = (weeks) => setStartDate(prev => addDays(prev, weeks * 7));
    const goToToday = () => setStartDate(getMonday(new Date()));

    // 1件のみのセルは2行（最大8文字）、複数件のセルは1行（最大4文字）で表示
    const shortenName = (name, maxLen = 4) => {
        if (!name) return '';
        return name.length > maxLen ? name.substring(0, maxLen) : name;
    };

    const periodLabel = `${startDate.getMonth() + 1}/${startDate.getDate()} 〜 ${addDays(startDate, totalDays - 1).getMonth() + 1}/${addDays(startDate, totalDays - 1).getDate()}`;

    if (shareKey && error === 'invalid_key') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
                <div className="bg-white rounded-xl shadow-md p-6 max-w-sm w-full text-center">
                    <LinkIcon className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                    <h1 className="font-bold text-slate-800 mb-2">共有URLが無効です</h1>
                    <p className="text-sm text-slate-500">
                        このURLは停止または再発行されています。管理者に新しいURLを確認してください。
                    </p>
                </div>
            </div>
        );
    }

    if (!shareKey && isAuthLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-100">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!shareKey && isPasswordRecovery) {
        return <ResetPasswordScreen />;
    }

    if (!shareKey && !isAuthenticated) {
        return <LoginScreen title="工程表閲覧" subtitle="ログイン" />;
    }

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
                            aria-label="前の2週間"
                            title="前の2週間"
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
                            aria-label="次の2週間"
                            title="次の2週間"
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
                                const style = getDayBg(col);
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

                    {/* 案件バーチャート */}
                    <tbody className="border-b-2 border-slate-400">
                        {visibleBars.length === 0 ? (
                            <tr>
                                <td className="sticky left-0 z-10 bg-white text-[10px] text-slate-400 p-1 border border-slate-200">案件</td>
                                <td colSpan={totalDays} className="text-[10px] text-slate-400 p-1 border border-slate-200">
                                    この期間の案件はありません
                                </td>
                            </tr>
                        ) : visibleBars.map(p => {
                            const labelIdx = dateColumns.findIndex((c, i) => i >= p.startIdx && i <= p.endIdx && !c.isOff);
                            const labelAt = labelIdx === -1 ? p.startIdx : labelIdx;
                            return (
                                <tr key={p.id} className="bg-white">
                                    <td
                                        className="sticky left-0 z-10 bg-white text-[10px] font-bold p-1 border border-slate-200"
                                        title={p.name}
                                    >
                                        {/* 幅固定しないと長い案件名で表全体が広がる */}
                                        <div className="w-16 truncate">{p.name}</div>
                                    </td>
                                    {dateColumns.map((col, i) => {
                                        const inBar = i >= p.startIdx && i <= p.endIdx;
                                        const today = isToday(col.dateStr);
                                        const bg = inBar
                                            ? (col.isOff ? '#FEE2E24D' : p.color + 'CC')
                                            : col.isOff ? '#FEE2E24D' : today ? '#EFF6FF' : undefined;
                                        return (
                                            <td
                                                key={i}
                                                className="relative p-0 border border-slate-200"
                                                style={{ backgroundColor: bg }}
                                            >
                                                <div className="h-5"></div>
                                                {inBar && i === labelAt && (
                                                    <div
                                                        className="absolute left-0.5 top-0 h-5 flex items-center text-[10px] font-bold whitespace-nowrap pointer-events-none z-[5]"
                                                        style={{ textShadow: '0 0 2px #fff, 0 0 2px #fff' }}
                                                    >
                                                        {p.name}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>

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
                                    const today = isToday(col.dateStr);

                                    return (
                                        <td
                                            key={i}
                                            className={`border border-slate-200 p-0 text-center align-middle ${today ? 'ring-1 ring-blue-400 ring-inset' : ''}`}
                                            style={{
                                                backgroundColor: col.isOff ? '#FEE2E24D' : today ? '#EFF6FF' : undefined,
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
                                                        const twoLine = cellAssigns.length === 1;
                                                        const displayName = a.title || shortenName(pInfo?.name || '', twoLine ? 8 : 4);
                                                        const bgColor = schedType?.color || pInfo?.color || '#94A3B8';
                                                        return (
                                                            <div
                                                                key={ai}
                                                                className={`text-[8px] font-bold rounded px-0.5 py-0.5 text-black ${twoLine ? 'line-clamp-2 break-all leading-tight' : 'truncate'}`}
                                                                style={{
                                                                    backgroundColor: bgColor,
                                                                    color: 'black'
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
