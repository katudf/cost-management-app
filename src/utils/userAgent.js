// User-Agent 文字列から OS とブラウザの表示名を推定する（パスワード変更履歴の端末表示用）。
// 厳密な判定ではなく、管理者が「どの端末か」を見分けられる程度の粒度にとどめる。

const UNKNOWN = '不明';

const detectOs = (ua) => {
    if (/iPhone/.test(ua)) return 'iOS (iPhone)';
    if (/iPad/.test(ua)) return 'iPadOS';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    // iPadOS 13 以降の Safari は Mac として UA を送るため、ここでは区別できない
    if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Linux/.test(ua)) return 'Linux';
    return UNKNOWN;
};

const detectBrowser = (ua) => {
    // 判定順に意味がある（Edge / Samsung などの UA には Chrome / Safari も含まれる）
    if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
    if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
    if (/Line\//.test(ua)) return 'LINE';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
    if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return UNKNOWN;
};

export const parseUserAgent = (ua) => {
    if (!ua || typeof ua !== 'string') return { os: UNKNOWN, browser: UNKNOWN };
    return { os: detectOs(ua), browser: detectBrowser(ua) };
};
