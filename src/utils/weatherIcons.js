// ウェザーニュースの天気アイコン（src/img/wether/*.png）を扱うモジュール。
// アイコン番号はウェザーニュースのページから直接取得できるため天気コードの変換表は不要。
//
// ラベルはページ側の img が alt 空のためスクレイピングできない。
// 公式の一覧（https://weathernews.jp/s/topics/img/wxicon/）に掲載されている
// 33種類の番号と名称をそのまま対応表にしている。

// Vite の glob インポートで全アイコンのURLを一括取得する（番号→URL）
const iconModules = import.meta.glob('../img/wether/*.png', { eager: true, import: 'default' });

const ICON_URLS = Object.entries(iconModules).reduce((acc, [path, url]) => {
    const num = path.match(/(\d+)\.png$/)?.[1];
    if (num) acc[num] = url;
    return acc;
}, {});

// 公式一覧の番号→天気名。1つの番号に複数の名称がある場合は代表的なものを採用した。
const ICON_LABELS = {
    100: '晴れ',
    101: '晴れ時々くもり',
    102: '晴れ一時雨',
    104: '晴れ一時雪',
    110: '晴れのちくもり',
    112: '晴れのち雨',
    115: '晴れのち雪',
    200: 'くもり',
    201: 'くもり時々晴れ',
    202: 'くもり一時雨',
    204: 'くもり一時雪',
    210: 'くもりのち晴れ',
    212: 'くもりのち雨',
    215: 'くもりのち雪',
    300: '雨',
    301: '雨時々晴れ',
    302: '雨時々止む',
    303: '雨時々雪',
    311: '雨のち晴れ',
    313: '雨のちくもり',
    314: '雨のち雪',
    400: '雪',
    401: '雪時々晴れ',
    402: '雪時々止む',
    403: '雪時々雨',
    411: '雪のち晴れ',
    413: '雪のちくもり',
    414: '雪のち雨',
    430: 'みぞれ',
    550: '猛暑',
    650: '小雨',
    850: '大雨・嵐',
    950: '大雪・吹雪',
};

// 公式一覧に無い番号（夜間・詳細バリエーション等）は、同じ番号台の
// 代表アイコンにフォールバックさせるための百の位→基本天気の対応。
const BASE_LABELS = {
    1: '晴れ',
    2: 'くもり',
    3: '雨',
    4: '雪',
    5: '猛暑',
    6: '小雨',
    8: '大雨・嵐',
    9: '大雪・吹雪',
};

/**
 * ウェザーニュースのアイコン番号から画像URLと天気名を返す。
 * 一覧に無い番号は同系統の代表アイコン（X00）と基本天気名にフォールバックする。
 * @param {string|number} iconNumber ウェザーニュースのアイコン番号（例: 200）
 * @returns {{url: string, label: string} | null}
 */
export const getWeatherIcon = (iconNumber) => {
    if (iconNumber === null || iconNumber === undefined) return null;
    const key = String(iconNumber);
    const url = ICON_URLS[key] ?? ICON_URLS[`${key[0]}00`];
    if (!url) return null;
    const label = ICON_LABELS[key] ?? BASE_LABELS[Number(key[0])] ?? '不明';
    return { url, label };
};
