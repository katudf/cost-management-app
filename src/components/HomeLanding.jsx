import React, { useState, useEffect } from 'react';
import { HardHat, Calendar, Clipboard, FileText, Users, Database, Settings, LogOut } from 'lucide-react';
import { useCompanyInfo } from '../hooks/useCompanyInfo';
import WeatherPanel from './WeatherPanel';
import logoUrl from '../img/logo.png';

// トップページのタイル定義。key は AdminApp の activeTab と対応する。
const TILES = [
    { key: 'dashboard', label: '現場管理', Icon: HardHat },
    { key: 'assignment', label: '工程表', Icon: Calendar },
    { key: 'estimate', label: '見積', Icon: Clipboard },
    { key: 'daily_report', label: '日報管理', Icon: FileText },
    { key: 'workers', label: '作業員管理', Icon: Users },
    { key: 'paint_db', label: 'データベース', Icon: Database },
];

const SETTINGS_TILE = { key: 'settings', label: '設定', Icon: Settings };

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const formatNow = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}（${WEEKDAYS[d.getDay()]}）${p(d.getHours())}：${p(d.getMinutes())}`;
};

const HomeLanding = ({ onNavigate, staffName, onSignOut, systemName = 'CostNavi' }) => {
    const { companyInfo } = useCompanyInfo('company_name');
    const companyName = companyInfo?.company_name || '';
    const [now, setNow] = useState(() => new Date());

    // 分が変わるタイミングに合わせて時刻表示を更新する
    useEffect(() => {
        let timeoutId;
        let intervalId;
        const tick = () => setNow(new Date());
        timeoutId = setTimeout(() => {
            tick();
            intervalId = setInterval(tick, 60000);
        }, (60 - new Date().getSeconds()) * 1000);
        return () => { clearTimeout(timeoutId); clearInterval(intervalId); };
    }, []);

    const tileClass = 'group flex items-center gap-4 px-6 py-5 rounded-xl bg-white border-2 border-emerald-200 shadow-sm text-left transition hover:border-emerald-400 hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2';

    return (
        <div className="min-h-screen bg-gradient-to-b from-sky-50 to-slate-100 p-4 md:p-8 font-sans text-slate-900">
            <div className="max-w-5xl mx-auto">
                <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-10">
                    <div className="flex items-center gap-4">
                        <img src={logoUrl} alt="" className="w-14 h-14 md:w-16 md:h-16 object-contain shrink-0" />
                        <div>
                            <p className="text-lg md:text-xl font-bold text-slate-800 leading-tight">{companyName || ' '}</p>
                            <p className="text-xl md:text-2xl font-bold text-emerald-700 tracking-wide leading-tight">{systemName}</p>
                        </div>
                    </div>
                    <div className="flex flex-col items-start sm:items-end gap-2">
                        <p className="text-sm font-bold text-slate-500 tabular-nums">{formatNow(now)}</p>
                        <div className="flex items-center gap-2 bg-white/70 rounded-lg px-3 py-1.5 border border-slate-200">
                            {staffName && <span className="text-sm font-bold text-slate-600 whitespace-nowrap">{staffName} さん</span>}
                            <button
                                onClick={onSignOut}
                                aria-label="ログアウト"
                                title="ログアウト"
                                className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition"
                            >
                                <LogOut size={18} />
                            </button>
                        </div>
                    </div>
                </header>

                <nav aria-label="メインメニュー">
                    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                        {TILES.map(({ key, label, Icon }) => (
                            <li key={key}>
                                <button onClick={() => onNavigate(key)} className={`${tileClass} w-full h-full`}>
                                    <span className="flex items-center justify-center w-12 h-12 rounded-lg bg-emerald-100 text-emerald-700 shrink-0 transition group-hover:bg-emerald-200">
                                        <Icon size={26} />
                                    </span>
                                    <span className="text-xl md:text-2xl font-bold text-slate-700">{label}</span>
                                </button>
                            </li>
                        ))}
                        <li>
                            <button onClick={() => onNavigate(SETTINGS_TILE.key)} className={`${tileClass} w-full h-full`}>
                                <span className="flex items-center justify-center w-12 h-12 rounded-lg bg-slate-100 text-slate-600 shrink-0 transition group-hover:bg-slate-200">
                                    <SETTINGS_TILE.Icon size={26} />
                                </span>
                                <span className="text-xl md:text-2xl font-bold text-slate-700">{SETTINGS_TILE.label}</span>
                            </button>
                        </li>
                    </ul>
                </nav>

                <WeatherPanel />
            </div>
        </div>
    );
};

export default HomeLanding;
