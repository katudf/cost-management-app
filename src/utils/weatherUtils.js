// 気象パネル・配置表で共通に使う地点情報と表示フォーマットのユーティリティ。
// 天気アイコンとラベルは weatherIcons.js を参照（ウェザーニュースのアイコン番号ベース）。

export const OSHU_LOCATION = {
    id: 'oshu',
    name: '岩手県奥州市',
    latitude: 39.1444,
    longitude: 141.1389,
};

// 任意地点の保存先（localStorage）
export const WEATHER_LOCATION_KEY = 'costnavi_weather_location';

/** 天気パネルで保存した地点を読み出す（未設定なら奥州市） */
export const loadSavedLocation = () => {
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

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' 形式から曜日1文字（例: 金）を返す */
export const formatWeekdayChar = (isoDate) => WEEKDAYS[new Date(`${isoDate}T00:00:00`).getDay()];

/** 'YYYY-MM-DD' 形式から曜日名（例: 金曜日）を返す */
export const formatWeekdayFull = (isoDate) => `${formatWeekdayChar(isoDate)}曜日`;

/** 数値を単位付きで整形する。null/undefined は '—' を返す */
export const formatValue = (value, unit, digits = 1) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${Number(value).toFixed(digits)}${unit}`;
};
