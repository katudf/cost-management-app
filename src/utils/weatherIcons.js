// ウェザーニュース形式の天気アイコン（src/img/wether/*.png）と
// Open-Meteo の天気コード（WMO 4677）の対応表。
// アイコン番号の意味: https://weathernews.jp/s/topics/img/wxicon/

// Vite の glob インポートで全アイコンのURLを一括取得する（番号→URL）
const iconModules = import.meta.glob('../img/wether/*.png', { eager: true, import: 'default' });

const ICON_URLS = Object.entries(iconModules).reduce((acc, [path, url]) => {
    const num = path.match(/(\d+)\.png$/)?.[1];
    if (num) acc[num] = url;
    return acc;
}, {});

/**
 * WMO 天気コード → ウェザーニュースのアイコン番号・天気名。
 * このアイコンセットには雷・霧の専用絵柄が無いため、
 * 雷雨は 850（大雨・嵐）、霧は 200（くもり）で代用する。
 */
const WMO_TO_ICON = {
    0: { icon: '100', label: '晴れ' },
    1: { icon: '100', label: '晴れ' },
    2: { icon: '101', label: '晴れ時々くもり' },
    3: { icon: '200', label: 'くもり' },
    45: { icon: '200', label: '霧' },
    48: { icon: '200', label: '着氷性の霧' },
    51: { icon: '650', label: '小雨' },
    53: { icon: '650', label: '小雨' },
    55: { icon: '300', label: '霧雨（強）' },
    56: { icon: '650', label: '着氷性霧雨' },
    57: { icon: '300', label: '着氷性霧雨（強）' },
    61: { icon: '650', label: '弱い雨' },
    63: { icon: '300', label: '雨' },
    65: { icon: '850', label: '大雨' },
    66: { icon: '430', label: '着氷性の雨' },
    67: { icon: '850', label: '着氷性の雨（強）' },
    71: { icon: '400', label: '弱い雪' },
    73: { icon: '400', label: '雪' },
    75: { icon: '950', label: '大雪' },
    77: { icon: '400', label: '霧雪' },
    80: { icon: '650', label: 'にわか雨' },
    81: { icon: '300', label: 'にわか雨' },
    82: { icon: '850', label: '激しいにわか雨' },
    85: { icon: '400', label: 'にわか雪' },
    86: { icon: '950', label: '強いにわか雪' },
    95: { icon: '850', label: '雷雨' },
    96: { icon: '850', label: '雷雨・雹' },
    99: { icon: '850', label: '雷雨・雹（強）' },
};

/**
 * 天気コードからアイコン画像URLと天気名を返す。
 * 未知のコード・アイコン欠損時は null を返す。
 * @param {number} code WMO 天気コード
 * @returns {{url: string, label: string} | null}
 */
export const getWeatherIcon = (code) => {
    const entry = WMO_TO_ICON[code];
    if (!entry) return null;
    const url = ICON_URLS[entry.icon];
    if (!url) return null;
    return { url, label: entry.label };
};
