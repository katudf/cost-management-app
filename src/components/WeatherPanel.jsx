import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapPin, Search, Loader2, X, CloudOff } from 'lucide-react';
import { useWeather, useLocationSearch } from '../hooks/useWeather';
import {
    OSHU_LOCATION, WEATHER_LOCATION_KEY, loadSavedLocation,
    formatWeekdayChar, formatWeekdayFull, formatValue,
} from '../utils/weatherUtils';
import { getWeatherIcon } from '../utils/weatherIcons';

/** ウェザーニュースのアイコン番号でPNGアイコンを表示する */
const WeatherIcon = ({ icon, size = 24 }) => {
    const entry = getWeatherIcon(icon);
    if (!entry) return <CloudOff size={size} className="text-slate-400" aria-label="天気不明" />;
    return <img src={entry.url} alt={entry.label} title={entry.label} width={size} height={size} style={{ width: size, height: size }} />;
};

// チャート内（SVG）の配色。トップ画面のライト背景に合わせた色
const INK = '#334155';        // 数値ラベル（slate-700）
const MUTED = '#94a3b8';      // 時刻ラベル（slate-400）
const TEMP_COLOR = '#f0b429'; // 気温の黄色
const RAIN_COLOR = '#38bdf8'; // 降水量の水色（sky-400）
const WIND_COLOR = '#0ea5e9'; // 風向矢印（sky-500）

// Google天気風のタブ。ウェザーニュースは積雪量・湿度を提供しないため対象外
const TABS = [
    { key: 'temp', label: '温度' },
    { key: 'wind', label: '風' },
    { key: 'precipitation', label: '降水量' },
];

// チャートは3時間毎の8ブロック（2:00, 5:00, ... 23:00）で描画する
const BLOCK_COUNT = 8;
const CHART_W = 800;
const CHART_H = 168;
const BASE_Y = 130;   // グラフの基準線（下端）
const FILL_Y = 138;   // 塗りつぶしの下端
const TOP_Y = 66;     // グラフ値の上限位置
const LABEL_Y = 52;   // 数値ラベルの位置
const TIME_Y = 160;   // 時刻ラベルの位置
const colX = (i) => 50 + 100 * i;
const blockTime = (i) => `${3 * i + 2}:00`;

// 温度カーブ（黄色のエリアチャート）
const TempChart = ({ temps }) => {
    const values = temps.map((t) => t ?? 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 1);
    const y = (t) => BASE_Y - ((t - min) / span) * (BASE_Y - 78);
    const pts = values.map((t, i) => [colX(i), y(t)]);
    const line = `M0,${pts[0][1].toFixed(1)} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${CHART_W},${pts[pts.length - 1][1].toFixed(1)}`;
    const area = `${line} L${CHART_W},${FILL_Y} L0,${FILL_Y} Z`;

    return (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[40rem]" role="img" aria-label="3時間毎の温度グラフ">
            <path d={area} fill={TEMP_COLOR} fillOpacity="0.28" />
            <path d={line} fill="none" stroke={TEMP_COLOR} strokeWidth="2.5" strokeLinejoin="round" />
            {pts.map(([px, py], i) => (
                <g key={i}>
                    {temps[i] !== null && (
                        <text x={px} y={py - 12} textAnchor="middle" fontSize="14" fontWeight="bold" fill={INK}>
                            {Math.round(temps[i])}
                        </text>
                    )}
                    <text x={px} y={TIME_Y} textAnchor="middle" fontSize="13" fill={MUTED}>{blockTime(i)}</text>
                </g>
            ))}
        </svg>
    );
};

// 降水量のステップチャート（青のライン＋塗りつぶし）
const StepChart = ({ blocks, labels, scaleMax, ariaLabel }) => {
    const yOf = (v) => BASE_Y - (Math.min(v ?? 0, scaleMax) / scaleMax) * (BASE_Y - TOP_Y);
    const ys = blocks.map(yOf);
    const step = `M0,${ys[0].toFixed(1)} ${ys.map((yv, i) => `H${(i + 1) * 100}${i < ys.length - 1 ? ` V${ys[i + 1].toFixed(1)}` : ''}`).join(' ')}`;

    return (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[40rem]" role="img" aria-label={ariaLabel}>
            {ys.map((yv, i) => (
                <rect key={i} x={i * 100} y={yv} width="100" height={FILL_Y - yv} fill={RAIN_COLOR} fillOpacity="0.25" />
            ))}
            <path d={step} fill="none" stroke={RAIN_COLOR} strokeWidth="3" />
            {blocks.map((_, i) => (
                <g key={i}>
                    <text x={colX(i)} y={LABEL_Y} textAnchor="middle" fontSize="14" fontWeight="bold" fill={INK}>{labels[i]}</text>
                    <text x={colX(i)} y={TIME_Y} textAnchor="middle" fontSize="13" fill={MUTED}>{blockTime(i)}</text>
                </g>
            ))}
        </svg>
    );
};

// 風速＋風向矢印（矢印は風が吹いていく方向を指す）
const WindChart = ({ speeds, directions }) => (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[40rem]" role="img" aria-label="3時間毎の風速・風向">
        {speeds.map((s, i) => (
            <g key={i}>
                <text x={colX(i)} y={LABEL_Y} textAnchor="middle" fontSize="14" fontWeight="bold" fill={INK}>
                    {s === null ? '—' : `${Math.round(s)} m/s`}
                </text>
                {/* 風向が無い（無風）ブロックは矢印を描かない */}
                {directions[i] !== null && directions[i] !== undefined && (
                    <g transform={`translate(${colX(i)}, 102) rotate(${(directions[i] + 180) % 360})`}>
                        <path d="M0,12 L0,-10 M-6,-3 L0,-10 L6,-3" fill="none" stroke={WIND_COLOR} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                )}
                <text x={colX(i)} y={TIME_Y} textAnchor="middle" fontSize="13" fill={MUTED}>{blockTime(i)}</text>
            </g>
        ))}
    </svg>
);

const WeatherPanel = () => {
    const [location, setLocation] = useState(loadSavedLocation);
    const [activeTab, setActiveTab] = useState('temp');
    const [selectedDay, setSelectedDay] = useState(0);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [keyword, setKeyword] = useState('');
    const pickerRef = useRef(null);

    const { weather, isLoading, error } = useWeather(location);
    const { results, isSearching, search, clear } = useLocationSearch();

    // 選択地点を保存する（固定地点の奥州市は保存不要）
    useEffect(() => {
        try {
            if (location.id === OSHU_LOCATION.id) localStorage.removeItem(WEATHER_LOCATION_KEY);
            else localStorage.setItem(WEATHER_LOCATION_KEY, JSON.stringify(location));
        } catch (e) {
            console.error('地点の保存エラー:', e);
        }
        setSelectedDay(0);
    }, [location]);

    // 地点選択パネルの外側クリックで閉じる
    useEffect(() => {
        if (!isPickerOpen) return;
        const onClickOutside = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) setIsPickerOpen(false);
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [isPickerOpen]);

    const handleSelect = (item) => {
        setLocation({
            id: `geo-${item.id}`,
            name: item.name,
            latitude: item.latitude,
            longitude: item.longitude,
        });
        setKeyword('');
        clear();
        setIsPickerOpen(false);
    };

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        search(keyword);
    };

    // 週間予報（当日から15日分）
    const days = weather?.daily ?? [];
    const day = days[selectedDay];
    const isToday = selectedDay === 0;

    // 選択日の1時間毎データ（時刻→データのマップ。ウェザーニュースは
    // 当日の過ぎた時刻や6日目以降が欠けるため、時刻をキーに引く）
    const hourMap = useMemo(() => {
        const rows = (day && weather?.hourlyByDate?.get(day.date)) || [];
        return new Map(rows.map((h) => [h.hour, h]));
    }, [weather, day]);

    const hasHourly = hourMap.size > 0;

    // 3時間毎の8ブロック値。代表時刻（2, 5, ... 23時）の値を使い、降水量は3時間の合計
    const sampleAt = (getter) => Array.from({ length: BLOCK_COUNT }, (_, i) => getter(hourMap.get(3 * i + 2)) ?? null);
    const sumOf = (getter) => Array.from({ length: BLOCK_COUNT }, (_, i) => {
        const slots = [3 * i, 3 * i + 1, 3 * i + 2].map((h) => hourMap.get(h)).filter(Boolean);
        if (!slots.length) return null;
        return slots.reduce((s, h) => s + (getter(h) ?? 0), 0);
    });

    const tempBlocks = sampleAt((h) => h?.temperature);
    const windBlocks = sampleAt((h) => h?.windSpeed);
    const windDirBlocks = sampleAt((h) => h?.windDirection);
    const precipBlocks = sumOf((h) => h?.precipitation);
    const amountScale = (blocks) => Math.max(...blocks.map((v) => v ?? 0), 1);

    // 当日は直近の時刻、それ以外は日中（12時）の値をヘッダーに出す
    const headHour = isToday
        ? hourMap.get(new Date().getHours()) ?? hourMap.get(12)
        : hourMap.get(12);
    const headTemp = headHour?.temperature ?? day?.tempMax;
    const headWind = headHour?.windSpeed;

    return (
        <section aria-label="気象情報" className="mt-6 md:mt-8">
            <div className="bg-white rounded-xl border-2 border-emerald-200 shadow-sm p-4 md:p-6">
                {isLoading && (
                    <p className="flex items-center justify-center gap-2 py-10 text-slate-500">
                        <Loader2 size={18} className="animate-spin" />気象データを取得中…
                    </p>
                )}

                {!isLoading && error && (
                    <p className="flex items-center justify-center gap-2 py-10 text-red-600 text-sm font-bold">
                        <X size={16} />気象データを取得できませんでした
                    </p>
                )}

                {!isLoading && !error && weather && day && (
                    <>
                        {/* ヘッダー: 現況（左）と地点・曜日・天気（右） */}
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <WeatherIcon icon={day.icon} size={64} />
                                <div className="flex items-start">
                                    <span className="text-6xl leading-none text-slate-800 tabular-nums">
                                        {headTemp !== null && headTemp !== undefined ? Math.round(headTemp) : '—'}
                                    </span>
                                    <span className="text-lg text-slate-500 mt-1 ml-1">℃</span>
                                </div>
                                <div className="text-xs text-slate-600 leading-5 ml-2 mt-1">
                                    <p>降水確率: {day.probability !== null && day.probability !== undefined ? `${Math.round(day.probability)}%` : '—'}</p>
                                    <p>最高 / 最低: {formatValue(day.tempMax, '℃', 0)} / {formatValue(day.tempMin, '℃', 0)}</p>
                                    <p>風速: {headWind !== null && headWind !== undefined ? `${Math.round(headWind)} m/s` : '—'}</p>
                                </div>
                            </div>

                            <div className="text-right relative" ref={pickerRef}>
                                <div className="flex items-center justify-end gap-1">
                                    <h2 className="text-lg md:text-xl font-bold text-slate-800">{location.name}</h2>
                                    <button
                                        onClick={() => setIsPickerOpen((v) => !v)}
                                        aria-label="地点を変更"
                                        title="地点を変更"
                                        className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition"
                                    >
                                        <Search size={16} />
                                    </button>
                                </div>
                                <p className="text-sm text-slate-500">{formatWeekdayFull(day.date)}</p>
                                <p className="text-sm text-slate-500">{getWeatherIcon(day.icon)?.label ?? '—'}</p>

                                {isPickerOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg border border-slate-200 shadow-lg z-20 p-3 text-left">
                                        <form onSubmit={handleSearchSubmit} className="flex gap-2 mb-2">
                                            <input
                                                type="text"
                                                value={keyword}
                                                onChange={(e) => setKeyword(e.target.value)}
                                                placeholder="地点名を入力（例: 奥州市）"
                                                className="flex-1 min-w-0 px-3 py-2 text-sm bg-white text-slate-800 placeholder-slate-400 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                            />
                                            <button
                                                type="submit"
                                                className="px-3 py-2 text-sm font-bold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition shrink-0"
                                            >
                                                検索
                                            </button>
                                        </form>

                                        <button
                                            onClick={() => { setLocation(OSHU_LOCATION); setKeyword(''); clear(); setIsPickerOpen(false); }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 rounded-md transition text-left"
                                        >
                                            <MapPin size={14} className="text-emerald-600 shrink-0" />
                                            {OSHU_LOCATION.name}（既定）
                                        </button>

                                        {isSearching && (
                                            <p className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
                                                <Loader2 size={14} className="animate-spin" />検索中…
                                            </p>
                                        )}

                                        {!isSearching && results.length > 0 && (
                                            <ul className="max-h-56 overflow-y-auto mt-1 border-t border-slate-200 pt-1">
                                                {results.map((item) => (
                                                    <li key={item.id}>
                                                        <button
                                                            onClick={() => handleSelect(item)}
                                                            className="w-full px-3 py-2 text-sm hover:bg-slate-100 rounded-md transition text-left"
                                                        >
                                                            <span className="font-bold text-slate-800">{item.name}</span>
                                                            <span className="text-slate-500 ml-2">{item.detail}</span>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* タブ */}
                        <div className="flex gap-5 border-b border-slate-200 mt-3 overflow-x-auto">
                            {TABS.map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setActiveTab(key)}
                                    className={`pb-2 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition ${
                                        activeTab === key
                                            ? 'text-slate-800 border-[#f0b429]'
                                            : 'text-slate-400 border-transparent hover:text-slate-700'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* チャート */}
                        <div className="overflow-x-auto mt-2">
                            {!hasHourly && (
                                <p className="py-14 text-center text-sm text-slate-500">1時間ごとの予報はありません。</p>
                            )}
                            {hasHourly && activeTab === 'temp' && <TempChart temps={tempBlocks} />}
                            {hasHourly && activeTab === 'wind' && <WindChart speeds={windBlocks} directions={windDirBlocks} />}
                            {hasHourly && activeTab === 'precipitation' && (
                                <StepChart
                                    blocks={precipBlocks}
                                    labels={precipBlocks.map((v) => (v === null ? '—' : formatValue(v, 'mm')))}
                                    scaleMax={amountScale(precipBlocks)}
                                    ariaLabel="3時間毎の降水量グラフ"
                                />
                            )}
                        </div>

                        {/* 週間ストリップ（15日分） */}
                        <div className="flex overflow-x-auto gap-1 mt-3 pt-2 border-t border-slate-200">
                            {days.map((d, i) => (
                                <button
                                    key={d.date}
                                    onClick={() => setSelectedDay(i)}
                                    aria-pressed={i === selectedDay}
                                    className={`flex flex-col items-center gap-1.5 flex-1 min-w-[3.5rem] px-2 py-2.5 rounded-lg transition ${
                                        i === selectedDay ? 'bg-slate-100' : 'hover:bg-slate-50'
                                    }`}
                                >
                                    <span className="text-sm font-bold text-slate-700">{formatWeekdayChar(d.date)}</span>
                                    <WeatherIcon icon={d.icon} size={26} />
                                    <span className="text-sm tabular-nums whitespace-nowrap">
                                        <span className="text-slate-800">{Math.round(d.tempMax)}°</span>
                                        {' '}
                                        <span className="text-slate-400">{Math.round(d.tempMin)}°</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </section>
    );
};

export default WeatherPanel;
