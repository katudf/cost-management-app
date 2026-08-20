// Open-Meteo の天気コード（WMO 4677 準拠）と表示用ラベル・アイコンの対応表。
// https://open-meteo.com/en/docs

export const OSHU_LOCATION = {
    id: 'oshu',
    name: '岩手県奥州市',
    latitude: 39.1444,
    longitude: 141.1389,
};

// 任意地点の保存先（localStorage）
export const WEATHER_LOCATION_KEY = 'costnavi_weather_location';

const WEATHER_CODES = {
    0: { label: '快晴', icon: 'sun' },
    1: { label: '晴れ', icon: 'sun' },
    2: { label: '一部曇り', icon: 'cloud-sun' },
    3: { label: '曇り', icon: 'cloud' },
    45: { label: '霧', icon: 'fog' },
    48: { label: '着氷性の霧', icon: 'fog' },
    51: { label: '霧雨（弱）', icon: 'drizzle' },
    53: { label: '霧雨', icon: 'drizzle' },
    55: { label: '霧雨（強）', icon: 'drizzle' },
    56: { label: '着氷性霧雨', icon: 'drizzle' },
    57: { label: '着氷性霧雨（強）', icon: 'drizzle' },
    61: { label: '雨（弱）', icon: 'rain' },
    63: { label: '雨', icon: 'rain' },
    65: { label: '雨（強）', icon: 'rain' },
    66: { label: '着氷性の雨', icon: 'rain' },
    67: { label: '着氷性の雨（強）', icon: 'rain' },
    71: { label: '雪（弱）', icon: 'snow' },
    73: { label: '雪', icon: 'snow' },
    75: { label: '雪（強）', icon: 'snow' },
    77: { label: '霧雪', icon: 'snow' },
    80: { label: 'にわか雨（弱）', icon: 'rain' },
    81: { label: 'にわか雨', icon: 'rain' },
    82: { label: 'にわか雨（強）', icon: 'rain' },
    85: { label: 'にわか雪', icon: 'snow' },
    86: { label: 'にわか雪（強）', icon: 'snow' },
    95: { label: '雷雨', icon: 'thunder' },
    96: { label: '雷雨・雹', icon: 'thunder' },
    99: { label: '雷雨・雹（強）', icon: 'thunder' },
};

const UNKNOWN_WEATHER = { label: '不明', icon: 'cloud' };

/** 天気コードから表示用ラベル・アイコン種別を取得する */
export const describeWeather = (code) => WEATHER_CODES[code] ?? UNKNOWN_WEATHER;

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
