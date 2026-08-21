import { useState, useEffect, useCallback } from 'react';
import { loadSavedLocation } from '../utils/weatherUtils';
import { buildOneboxUrl, parseOneboxHtml } from '../utils/weathernewsParser';

// 地点検索は OpenStreetMap Nominatim を利用する（日本語で検索可能）
const GEOCODING_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** ウェザーニュースの onebox ページを取得して解析する */
const fetchOnebox = async (latitude, longitude) => {
    const res = await fetch(buildOneboxUrl(latitude, longitude));
    if (!res.ok) throw new Error(`天気情報の取得エラー: ${res.status}`);
    return parseOneboxHtml(await res.text());
};

/**
 * ウェザーニュースから気象データ（週間・1時間毎）を取得する。
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
                const parsed = await fetchOnebox(latitude, longitude);
                if (!cancelled) setWeather(parsed);
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
 * 地点名から候補を検索する（OpenStreetMap Nominatim）。
 * 日本語の地名でそのまま検索できる。国内の地点に絞って返す。
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
                q: keyword,
                format: 'jsonv2',
                limit: '10',
                countrycodes: 'jp',
                'accept-language': 'ja',
            });
            const res = await fetch(`${GEOCODING_ENDPOINT}?${params}`);
            if (!res.ok) throw new Error(`地点検索エラー: ${res.status}`);
            const data = await res.json();
            setResults((data || []).map((item) => ({
                id: String(item.place_id),
                name: item.name || item.display_name,
                // 「岩手県, 日本」のように国名まで含むため、先頭の地名と国名を除いて所属地域だけ残す
                detail: String(item.display_name || '').split(',').slice(1, -1).join(',').trim(),
                latitude: Number(item.lat),
                longitude: Number(item.lon),
            })));
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

/**
 * 日付ごとの天気アイコン番号を取得する（配置表の天気マーク用）。
 * 予報は当日から15日先まで。範囲を超える日はキーが存在しないため、
 * 呼び出し側で空表示にする。
 * @returns {{iconByDate: Map<string, string>, isLoading: boolean}}
 */
export function useDailyWeatherCodes() {
    const [iconByDate, setIconByDate] = useState(() => new Map());
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const location = loadSavedLocation();

        const fetchIcons = async () => {
            setIsLoading(true);
            try {
                const parsed = await fetchOnebox(location.latitude, location.longitude);
                if (cancelled) return;
                setIconByDate(new Map(parsed.daily.map((d) => [d.date, d.icon])));
            } catch (e) {
                console.error('気象データ取得エラー:', e);
                if (!cancelled) setIconByDate(new Map());
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        fetchIcons();
        return () => { cancelled = true; };
    }, []);

    return { iconByDate, isLoading };
}
