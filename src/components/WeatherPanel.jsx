import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Sun, Cloud, CloudSun, CloudRain, CloudDrizzle, CloudFog,
    Snowflake, CloudLightning, MapPin, Search, Loader2, X,
} from 'lucide-react';
import { useWeather, useLocationSearch } from '../hooks/useWeather';
import {
    OSHU_LOCATION, WEATHER_LOCATION_KEY,
    describeWeather, formatWeekdayChar, formatWeekdayFull, formatValue,
} from '../utils/weatherUtils';

const ICON_MAP = {
    sun: Sun,
    cloud: Cloud,
    'cloud-sun': CloudSun,
    rain: CloudRain,
    drizzle: CloudDrizzle,
    fog: CloudFog,
    snow: Snowflake,
    thunder: CloudLightning,
};

// ダーク背景で見やすい配色
const ICON_COLOR = {
    sun: 'text-amber-400',
    cloud: 'text-slate-300',
    'cloud-sun': 'text-amber-300',
    rain: 'text-blue-400',
    drizzle: 'text-blue-300',
    fog: 'text-slate-400',
    snow: 'text-sky-300',
    thunder: 'text-violet-400',
};

const WeatherIcon = ({ code, size = 24 }) => {
    const { icon, label } = describeWeather(code);
    const Icon = ICON_MAP[icon] ?? Cloud;
    return <Icon size={size} className={ICON_COLOR[icon] ?? 'text-slate-300'} aria-label={label} />;
};

// Google天気風のタブ。温度・降水確率・風に加え、要件の降水量・積雪量も同型式で表示する
const TABS = [
    { key: 'temp', label: '温度' },
    { key: 'probability', label: '降水確率' },
    { key: 'wind', label: '風' },
    { key: 'precipitation', label: '降水量' },
    { key: 'snowfall', label: '積雪量' },
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
const TempChart = ({ hours }) => {
    const temps = hours.map((h) => h.temperature ?? 0);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(max - min, 1);
    const y = (t) => BASE_Y - ((t - min) / span) * (BASE_Y - 78);
    const pts = temps.map((t, i) => [((i + 0.5) / 24) * CHART_W, y(t)]);
    const line = `M0,${pts[0][1].toFixed(1)} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${CHART_W},${pts[pts.length - 1][1].toFixed(1)}`;
    const area = `${line} L${CHART_W},${FILL_Y} L0,${FILL_Y} Z`;

    return (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[40rem]" role="img" aria-label="1時間毎の温度グラフ">
            <path d={area} fill="#fbbc04" fillOpacity="0.45" />
            <path d={line} fill="none" stroke="#fbbc04" strokeWidth="2.5" strokeLinejoin="round" />
            {Array.from({ length: BLOCK_COUNT }, (_, i) => {
                const h = 3 * i + 2;
                return (
                    <g key={i}>
                        <text x={pts[h][0]} y={pts[h][1] - 12} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#e8eaed">
                            {Math.round(temps[h])}
                        </text>
                        <text x={pts[h][0]} y={TIME_Y} textAnchor="middle" fontSize="13" fill="#9aa0a6">{blockTime(i)}</text>
                    </g>
                );
            })}
        </svg>
    );
};

// 降水確率・降水量・積雪量のステップチャート（青のライン＋塗りつぶし）
const StepChart = ({ blocks, labels, scaleMax, ariaLabel }) => {
    const yOf = (v) => BASE_Y - (Math.min(v, scaleMax) / scaleMax) * (BASE_Y - TOP_Y);
    const ys = blocks.map(yOf);
    const step = `M0,${ys[0].toFixed(1)} ${ys.map((yv, i) => `H${(i + 1) * 100}${i < ys.length - 1 ? ` V${ys[i + 1].toFixed(1)}` : ''}`).join(' ')}`;

    return (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[40rem]" role="img" aria-label={ariaLabel}>
            {ys.map((yv, i) => (
                <rect key={i} x={i * 100} y={yv} width="100" height={FILL_Y - yv} fill="#8ab4f8" fillOpacity="0.22" />
            ))}
            <path d={step} fill="none" stroke="#8ab4f8" strokeWidth="3" />
            {blocks.map((_, i) => (
                <g key={i}>
                    <text x={colX(i)} y={LABEL_Y} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#e8eaed">{labels[i]}</text>
                    <text x={colX(i)} y={TIME_Y} textAnchor="middle" fontSize="13" fill="#9aa0a6">{blockTime(i)}</text>
                </g>
            ))}
        </svg>
    );
};

// 風速＋風向矢印（矢印は風が吹いていく方向を指す）
const WindChart = ({ speeds, directions }) => (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[40rem]" role="img" aria-label="1時間毎の風速・風向">
        {speeds.map((s, i) => (
            <g key={i}>
                <text x={colX(i)} y={LABEL_Y} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#e8eaed">
                    {Math.round(s ?? 0)} m/s
                </text>
                <g transform={`translate(${colX(i)}, 102) rotate(${((directions[i] ?? 0) + 180) % 360})`}>
                    <path d="M0,12 L0,-10 M-6,-3 L0,-10 L6,-3" fill="none" stroke="#aecbfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </g>
                <text x={colX(i)} y={TIME_Y} textAnchor="middle" fontSize="13" fill="#9aa0a6">{blockTime(i)}</text>
            </g>
        ))}
    </svg>
);

// 保存済みの任意地点を読み出す（未保存なら奥州市）
const loadSavedLocation = () => {
    try {
        const raw = localStorage.getItem(WEATHER_LOCATION_KEY);
        if (!raw) return OSHU_LOCATION;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.latitude === 'number' && typeof parsed?.longitude === 'number') return parsed;
    } catch (e) {
        console.error('保存地点の読み込みエラー:', e);
    }
    return OSHU_LOCATION;
};

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
            name: [item.admin1, item.name].filter(Boolean).join(' '),
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

    // 日別サマリー（8日分）
    const days = useMemo(() => {
        if (!weather?.daily) return [];
        return weather.daily.time.map((date, i) => ({
            date,
            code: weather.daily.weather_code[i],
            tempMax: weather.daily.temperature_2m_max[i],
            tempMin: weather.daily.temperature_2m_min[i],
            precipitation: weather.daily.precipitation_sum[i],
            probability: weather.daily.precipitation_probability_max[i],
            snowfall: weather.daily.snowfall_sum[i],
            windSpeed: weather.daily.wind_speed_10m_max[i],
        }));
    }, [weather]);

    // 日付ごとの1時間毎データ
    const hoursByDate = useMemo(() => {
        const map = new Map();
        if (!weather?.hourly) return map;
        weather.hourly.time.forEach((time, i) => {
            const date = time.slice(0, 10);
            if (!map.has(date)) map.set(date, []);
            map.get(date).push({
                temperature: weather.hourly.temperature_2m[i],
                humidity: weather.hourly.relative_humidity_2m[i],
                precipitation: weather.hourly.precipitation[i],
                probability: weather.hourly.precipitation_probability[i],
                snowfall: weather.hourly.snowfall[i],
                windSpeed: weather.hourly.wind_speed_10m[i],
                windDirection: weather.hourly.wind_direction_10m[i],
            });
        });
        return map;
    }, [weather]);

    const current = weather?.current;
    const day = days[selectedDay];
    const isToday = selectedDay === 0;
    const dayHours = (day && hoursByDate.get(day.date)) || [];
    const hasHourly = dayHours.length === 24;

    // ヘッダー表示値（当日は現況、それ以外は日別サマリー）
    const headTemp = isToday ? current?.temperature_2m : day?.tempMax;
    const headCode = isToday ? current?.weather_code : day?.code;
    const headHumidity = isToday
        ? current?.relative_humidity_2m
        : (hasHourly ? dayHours.reduce((s, h) => s + (h.humidity ?? 0), 0) / dayHours.length : null);
    const headWind = isToday ? current?.wind_speed_10m : day?.windSpeed;

    // 3時間毎の8ブロック値（確率・風は代表時刻の値、量は3時間の合計）
    const sampleAt = (getter) => Array.from({ length: BLOCK_COUNT }, (_, i) => getter(dayHours[3 * i + 2]) ?? 0);
    const sumOf = (getter) => Array.from({ length: BLOCK_COUNT }, (_, i) =>
        dayHours.slice(3 * i, 3 * i + 3).reduce((s, h) => s + (getter(h) ?? 0), 0));

    const probBlocks = sampleAt((h) => h?.probability);
    const windBlocks = sampleAt((h) => h?.windSpeed);
    const windDirBlocks = sampleAt((h) => h?.windDirection);
    const precipBlocks = sumOf((h) => h?.precipitation);
    const snowBlocks = sumOf((h) => h?.snowfall);
    const amountScale = (blocks) => Math.max(...blocks, 1);

    return (
        <section aria-label="気象情報" className="mt-6 md:mt-8">
            <div className="bg-[#202124] rounded-xl shadow-md p-4 md:p-6">
                {isLoading && (
                    <p className="flex items-center justify-center gap-2 py-10 text-[#9aa0a6]">
                        <Loader2 size={18} className="animate-spin" />気象データを取得中…
                    </p>
                )}

                {!isLoading && error && (
                    <p className="flex items-center justify-center gap-2 py-10 text-red-400 text-sm font-bold">
                        <X size={16} />気象データを取得できませんでした
                    </p>
                )}

                {!isLoading && !error && weather && day && (
                    <>
                        {/* ヘッダー: 現況（左）と地点・曜日・天気（右） */}
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <WeatherIcon code={headCode} size={64} />
                                <div className="flex items-start">
                                    <span className="text-6xl leading-none text-[#e8eaed] tabular-nums">
                                        {headTemp !== null && headTemp !== undefined ? Math.round(headTemp) : '—'}
                                    </span>
                                    <span className="text-lg text-[#9aa0a6] mt-1 ml-1">℃</span>
                                </div>
                                <div className="text-xs text-[#bdc1c6] leading-5 ml-2 mt-1">
                                    <p>降水確率: {day.probability !== null && day.probability !== undefined ? `${Math.round(day.probability)}%` : '—'}</p>
                                    <p>湿度: {headHumidity !== null && headHumidity !== undefined ? `${Math.round(headHumidity)}%` : '—'}</p>
                                    <p>風速: {headWind !== null && headWind !== undefined ? `${Math.round(headWind)} m/s` : '—'}</p>
                                </div>
                            </div>

                            <div className="text-right relative" ref={pickerRef}>
                                <div className="flex items-center justify-end gap-1">
                                    <h2 className="text-lg md:text-xl font-bold text-[#e8eaed]">{location.name}</h2>
                                    <button
                                        onClick={() => setIsPickerOpen((v) => !v)}
                                        aria-label="地点を変更"
                                        title="地点を変更"
                                        className="p-1.5 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#3c4043] rounded-lg transition"
                                    >
                                        <Search size={16} />
                                    </button>
                                </div>
                                <p className="text-sm text-[#9aa0a6]">{formatWeekdayFull(day.date)}</p>
                                <p className="text-sm text-[#9aa0a6]">{describeWeather(headCode).label}</p>

                                {isPickerOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-80 bg-[#292a2d] rounded-lg border border-[#3c4043] shadow-lg z-20 p-3 text-left">
                                        <form onSubmit={handleSearchSubmit} className="flex gap-2 mb-2">
                                            <input
                                                type="text"
                                                value={keyword}
                                                onChange={(e) => setKeyword(e.target.value)}
                                                placeholder="地点名をローマ字で入力（例: Oshu）"
                                                className="flex-1 min-w-0 px-3 py-2 text-sm bg-[#202124] text-[#e8eaed] placeholder-[#9aa0a6] border border-[#5f6368] rounded-md focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]"
                                            />
                                            <button
                                                type="submit"
                                                className="px-3 py-2 text-sm font-bold text-[#202124] bg-[#8ab4f8] rounded-md hover:bg-[#aecbfa] transition shrink-0"
                                            >
                                                検索
                                            </button>
                                        </form>

                                        <button
                                            onClick={() => { setLocation(OSHU_LOCATION); setKeyword(''); clear(); setIsPickerOpen(false); }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-[#e8eaed] hover:bg-[#3c4043] rounded-md transition text-left"
                                        >
                                            <MapPin size={14} className="text-[#8ab4f8] shrink-0" />
                                            {OSHU_LOCATION.name}（既定）
                                        </button>

                                        {isSearching && (
                                            <p className="flex items-center gap-2 px-3 py-2 text-sm text-[#9aa0a6]">
                                                <Loader2 size={14} className="animate-spin" />検索中…
                                            </p>
                                        )}

                                        {!isSearching && results.length > 0 && (
                                            <ul className="max-h-56 overflow-y-auto mt-1 border-t border-[#3c4043] pt-1">
                                                {results.map((item) => (
                                                    <li key={item.id}>
                                                        <button
                                                            onClick={() => handleSelect(item)}
                                                            className="w-full px-3 py-2 text-sm hover:bg-[#3c4043] rounded-md transition text-left"
                                                        >
                                                            <span className="font-bold text-[#e8eaed]">{item.name}</span>
                                                            <span className="text-[#9aa0a6] ml-2">
                                                                {[item.admin1, item.country].filter(Boolean).join('・')}
                                                            </span>
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
                        <div className="flex gap-5 border-b border-[#3c4043] mt-3 overflow-x-auto">
                            {TABS.map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setActiveTab(key)}
                                    className={`pb-2 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition ${
                                        activeTab === key
                                            ? 'text-[#e8eaed] border-[#fbbc04]'
                                            : 'text-[#9aa0a6] border-transparent hover:text-[#e8eaed]'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* チャート */}
                        <div className="overflow-x-auto mt-2">
                            {!hasHourly && (
                                <p className="py-14 text-center text-sm text-[#e8eaed]">1時間ごとの予報はありません。</p>
                            )}
                            {hasHourly && activeTab === 'temp' && <TempChart hours={dayHours} />}
                            {hasHourly && activeTab === 'probability' && (
                                <StepChart
                                    blocks={probBlocks}
                                    labels={probBlocks.map((v) => `${Math.round(v)}%`)}
                                    scaleMax={100}
                                    ariaLabel="1時間毎の降水確率グラフ"
                                />
                            )}
                            {hasHourly && activeTab === 'wind' && <WindChart speeds={windBlocks} directions={windDirBlocks} />}
                            {hasHourly && activeTab === 'precipitation' && (
                                <StepChart
                                    blocks={precipBlocks}
                                    labels={precipBlocks.map((v) => formatValue(v, 'mm'))}
                                    scaleMax={amountScale(precipBlocks)}
                                    ariaLabel="1時間毎の降水量グラフ"
                                />
                            )}
                            {hasHourly && activeTab === 'snowfall' && (
                                <StepChart
                                    blocks={snowBlocks}
                                    labels={snowBlocks.map((v) => formatValue(v, 'cm'))}
                                    scaleMax={amountScale(snowBlocks)}
                                    ariaLabel="1時間毎の積雪量グラフ"
                                />
                            )}
                        </div>

                        {/* 8日間ストリップ */}
                        <div className="flex overflow-x-auto gap-1 mt-3 pt-2 border-t border-[#3c4043]">
                            {days.map((d, i) => (
                                <button
                                    key={d.date}
                                    onClick={() => setSelectedDay(i)}
                                    aria-pressed={i === selectedDay}
                                    className={`flex flex-col items-center gap-1.5 flex-1 min-w-[3.5rem] px-2 py-2.5 rounded-lg transition ${
                                        i === selectedDay ? 'bg-[#3c4043]' : 'hover:bg-[#28292c]'
                                    }`}
                                >
                                    <span className="text-sm font-bold text-[#e8eaed]">{formatWeekdayChar(d.date)}</span>
                                    <WeatherIcon code={d.code} size={26} />
                                    <span className="text-sm tabular-nums whitespace-nowrap">
                                        <span className="text-[#e8eaed]">{Math.round(d.tempMax)}°</span>
                                        {' '}
                                        <span className="text-[#9aa0a6]">{Math.round(d.tempMin)}°</span>
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
