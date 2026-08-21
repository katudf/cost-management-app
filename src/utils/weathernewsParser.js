// ウェザーニュースの onebox ページ（HTML）から気象データを抽出するパーサ。
// API ではなく Web ページのスクレイピングのため、DOMParser で解析する。
//
// 取得元: https://weathernews.jp/onebox/{緯度}/{経度}/
//   - 週間ブロック: ul.wxweek_content が過去10日＋予報15日の計25行
//   - 1時間毎ブロック: #flick_list_1hour 内の div.group（日付ごと）> div.wx1h_content > ul.list
//
// 注意: 予報行は <ul id="wx__week0" class="wxweek_content"> のように
// id 属性が class より前に来るため、属性順に依存する正規表現では取りこぼす。
// DOMParser + querySelectorAll を使うことでこの問題を回避している。

const ONEBOX_ORIGIN = 'https://weathernews.jp';

/** 緯度経度から onebox ページのURLを組み立てる */
export const buildOneboxUrl = (latitude, longitude) =>
    `${ONEBOX_ORIGIN}/onebox/${Number(latitude).toFixed(4)}/${Number(longitude).toFixed(4)}/`;

/** テキストから最初の数値を取り出す（取得できなければ null） */
const pickNumber = (text) => {
    if (!text) return null;
    const m = String(text).match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
};

/** img の src からウェザーニュースのアイコン番号を取り出す（例: .../wxicon/200.png → '200'） */
const pickIconNumber = (img) => img?.getAttribute('src')?.match(/wxicon\/(\d+)(?:@2x)?\.png/)?.[1] ?? null;

// 風向インデックス（1〜16）→ 方位角。1 = 北、時計回りに 22.5 度刻み。0 は無風。
const parseWindDirection = (img) => {
    const m = img?.getAttribute('src')?.match(/wind_(\d+)_/);
    if (!m) return null;
    const index = Number(m[1]);
    // 0 は無風のため方位なし。ファイル名の後半は矢印画像の番号で風速ではない
    return index === 0 ? null : ((index - 1) * 22.5) % 360;
};

const pad2 = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 「日」だけの表記と基準日から 'YYYY-MM-DD' を復元する。
 * 週間ブロックは過去10日〜先15日を含むため月跨ぎの前後どちらもあり得る。
 */
const resolveDate = (day, baseDate) => {
    const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    // 前月・当月・翌月の候補から基準日に最も近いものを選ぶ
    const candidates = [-1, 0, 1].map((offset) => new Date(base.getFullYear(), base.getMonth() + offset, day));
    const nearest = candidates.reduce((best, d) =>
        Math.abs(d - base) < Math.abs(best - base) ? d : best);
    return toIso(nearest);
};

/**
 * 週間ブロック（過去10日＋予報15日）を解析する。
 * 過去行は class に past を含み .rain が降水量（ミリ）。予報行は .rain が降水確率（%）。
 */
const parseWeekRows = (doc, today) => {
    const rows = Array.from(doc.querySelectorAll('.wxweek_content'));
    return rows.map((row) => {
        const isPast = row.classList.contains('past');
        const day = pickNumber(row.querySelector('.date .day')?.textContent);
        if (day === null) return null;

        const rainValue = pickNumber(row.querySelector('.rain')?.textContent);

        return {
            date: resolveDate(day, today),
            isPast,
            icon: pickIconNumber(row.querySelector('.weather img')),
            tempMax: pickNumber(row.querySelector('.high')?.textContent),
            tempMin: pickNumber(row.querySelector('.low')?.textContent),
            // 過去行はミリ（実績降水量）、予報行は％（降水確率）
            probability: isPast ? null : rainValue,
            precipitation: isPast ? rainValue : null,
            // 予報信頼度（8日目以降に A〜E が付く）
            reliability: row.querySelector('.date .credibility')?.textContent?.trim() || null,
        };
    }).filter(Boolean);
};

/**
 * 1時間毎ブロックを解析する。日付ごとの div.group 単位で時刻行が並ぶ。
 * 各行は 時刻 / 天気アイコン / 降水量(ミリ) / 気温(℃) / 風向アイコン＋風速(m/s)。
 * @returns {Map<string, Array>} 日付 'YYYY-MM-DD' → 時刻行の配列
 */
const parseHourly = (doc, today) => {
    const byDate = new Map();
    const container = doc.querySelector('#flick_list_1hour');
    if (!container) return byDate;

    container.querySelectorAll('.group').forEach((group) => {
        const day = pickNumber(group.querySelector('.date')?.textContent);
        if (day === null) return;
        const date = resolveDate(day, today);

        const hours = Array.from(group.querySelectorAll('.wx1h_content ul')).map((row) => {
            const hour = pickNumber(row.querySelector('.time')?.textContent);
            if (hour === null) return null;
            const wind = row.querySelector('.wind');
            return {
                hour,
                isPast: row.classList.contains('past'),
                icon: pickIconNumber(row.querySelector('.weather img')),
                temperature: pickNumber(row.querySelector('.temp')?.textContent),
                precipitation: pickNumber(row.querySelector('.rain')?.textContent),
                // 風速は画像名ではなく表示テキスト（m/s）から取る
                windSpeed: pickNumber(wind?.querySelector('p')?.textContent),
                windDirection: parseWindDirection(wind?.querySelector('img')),
            };
        }).filter(Boolean);

        if (hours.length) byDate.set(date, hours);
    });

    return byDate;
};

/**
 * onebox ページのHTMLを解析して週間予報・1時間毎予報を返す。
 * @param {string} html 取得したHTML文字列
 * @param {Date} today 日付復元の基準日（テスト用に差し替え可能）
 */
export const parseOneboxHtml = (html, today = new Date()) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const week = parseWeekRows(doc, today);
    return {
        // 予報のみを表示に使う（過去実績はグラフ対象外）
        daily: week.filter((d) => !d.isPast),
        history: week.filter((d) => d.isPast),
        hourlyByDate: parseHourly(doc, today),
    };
};
