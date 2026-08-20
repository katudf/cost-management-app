import { useState, useEffect, useCallback } from 'react';
import { OSHU_LOCATION, WEATHER_LOCATION_KEY } from '../utils/weatherUtils';

const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

// Open-Meteo の予報可能日数の上限
const MAX_FORECAST_DAYS = 16;

// 取得項目: 気温 / 降水量 / 降水確率 / 積雪量 / 風速（+ 表示用の湿度・風向）
const CURRENT_FIELDS = 'temperature_2m,relative_humidity_2m,precipitation,snowfall,wind_speed_10m,weather_code';
const HOURLY_FIELDS = 'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,snowfall,wind_speed_10m,wind_direction_10m,weather_code';
const DAILY_FIELDS = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_speed_10m_max';

/**
 * Open-Meteo から気象データ（現在・1時間毎・週間）を取得する。
 * @param {{latitude:number, longitude:number}} location 取得地点の緯度経度
 */
export function useWeather(location) {
    const [weather, setWeather] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    const latitude = location?.latitude;
    const longitude = location?.longitude;

    useEffect(() => {
        if (latitude === undefined || longitude === undefined) return;
        let cancelled = false;

        const fetchWeather = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const params = new URLSearchParams({
                    latitude: String(latitude),
                    longitude: String(longitude),
                    current: CURRENT_FIELDS,
                    hourly: HOURLY_FIELDS,
                    daily: DAILY_FIELDS,
                    timezone: 'Asia/Tokyo',
                    wind_speed_unit: 'ms',
                    forecast_days: '8',
                });
                const res = await fetch(`${FORECAST_ENDPOINT}?${params}`);
                if (!res.ok) throw new Error(`天気APIエラー: ${res.status}`);
                const data = await res.json();
                if (!cancelled) setWeather(data);
            } catch (e) {
                console.error('気象データ取得エラー:', e);
                if (!cancelled) setError(e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        fetchWeather();
        return () => { cancelled = true; };
    }, [latitude, longitude]);

    return { weather, isLoading, error };
}

/**
 * 地点名から候補を検索する（Open-Meteo Geocoding API）。
 * 日本語名では検索できないためローマ字入力を想定。結果は日本語表記で返る。
 */
export function useLocationSearch() {
    const [results, setResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    const search = useCallback(async (query) => {
        const keyword = query.trim();
        if (!keyword) {
            setResults([]);
            return;
        }
        setIsSearching(true);
        try {
            const params = new URLSearchParams({
                name: keyword,
                count: '10',
                language: 'ja',
                format: 'json',
            });
            const res = await fetch(`${GEOCODING_ENDPOINT}?${params}`);
            if (!res.ok) throw new Error(`地点検索エラー: ${res.status}`);
            const data = await res.json();
            // 国内の地点を優先して表示する
            const list = (data.results || []).sort(
                (a, b) => (b.country_code === 'JP') - (a.country_code === 'JP')
            );
            setResults(list);
        } catch (e) {
            console.error('地点検索エラー:', e);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    }, []);

    const clear = useCallback(() => setResults([]), []);

    return { results, isSearching, search, clear };
}

/** 天気パネルで保存した地点を読み出す（未設定なら奥州市） */
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

/**
 * 日付ごとの天気コードを取得する（配置表の天気マーク用）。
 * 予報期間を超える日はキーが存在しないため、呼び出し側で空表示にする。
 * @returns {{codeByDate: Map<string, number>, isLoading: boolean}}
 */
export function useDailyWeatherCodes() {
    const [codeByDate, setCodeByDate] = useState(() => new Map());
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const location = loadSavedLocation();

        const fetchCodes = async () => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams({
                    latitude: String(location.latitude),
                    longitude: String(location.longitude),
                    daily: 'weather_code',
                    timezone: 'Asia/Tokyo',
                    forecast_days: String(MAX_FORECAST_DAYS),
                });
                const res = await fetch(`${FORECAST_ENDPOINT}?${params}`);
                if (!res.ok) throw new Error(`天気APIエラー: ${res.status}`);
                const data = await res.json();
                if (cancelled) return;
                const dates = data?.daily?.time || [];
                const codes = data?.daily?.weather_code || [];
                setCodeByDate(new Map(dates.map((d, i) => [d, codes[i]])));
            } catch (e) {
                console.error('気象データ取得エラー:', e);
                if (!cancelled) setCodeByDate(new Map());
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        fetchCodes();
        return () => { cancelled = true; };
    }, []);

    return { codeByDate, isLoading };
}
