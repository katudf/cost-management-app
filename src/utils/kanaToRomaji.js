// フリガナ（カタカナ・ひらがな）をローマ字にし、ログインIDの候補を作る（docs/specs/worker-login.md §4.4）。
// ヘボン式。ID に使うので長音は省く（サトウ → sato、オオクボ → okubo）。

const BASE = {
    ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
    カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
    ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
    サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
    ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
    タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
    ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
    ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
    ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
    バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
    パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
    マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
    ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
    ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
    ワ: 'wa', ヰ: 'i', ヱ: 'e', ヲ: 'o', ン: 'n', ヴ: 'vu',
    ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o',
};

// 拗音（キャ・シュ・チョ など）
const YOON = { ャ: 'a', ュ: 'u', ョ: 'o' };

const toKatakana = (text) => String(text ?? '').normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

/** カタカナ・ひらがなをローマ字にする。かな以外の文字は捨てる。 */
export const kanaToRomaji = (text) => {
    const chars = [...toKatakana(text)];
    let out = '';
    let doubleNext = false;
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === 'ッ') { doubleNext = true; continue; }
        if (ch === 'ー') continue;
        let syllable = BASE[ch];
        if (!syllable) continue;
        const next = chars[i + 1];
        if (next && YOON[next]) {
            // キャ → kya、シャ → sha、チャ → cha、ジャ → ja
            const stem = syllable.endsWith('i') ? syllable.slice(0, -1) : syllable;
            syllable = /^(sh|ch|j)$/.test(stem) ? stem + YOON[next] : stem + 'y' + YOON[next];
            i++;
        }
        if (doubleNext) {
            // ッチ → tchi、それ以外は子音を重ねる
            out += syllable.startsWith('ch') ? 't' : syllable[0];
            doubleNext = false;
        }
        out += syllable;
    }
    // 長音を省く（ou / oo → o、uu → u）
    return out.replace(/o[ou]/g, 'o').replace(/uu/g, 'u');
};

/**
 * フリガナからログインIDの候補を作る。「姓_名の頭文字」（サトウ カツヨシ → sato_k）。
 * taken に含まれるIDなら sato_k2, sato_k3… と番号を付ける。フリガナから作れなければ空文字。
 */
export const suggestLoginId = (kana, taken = []) => {
    const parts = String(kana ?? '').normalize('NFKC').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    const family = kanaToRomaji(parts[0]);
    const given = parts.length > 1 ? kanaToRomaji(parts.slice(1).join('')) : '';
    if (!family) return '';
    let base = given ? `${family}_${given[0]}` : family;
    base = base.slice(0, 18);
    if (base.length < 3) base = base.padEnd(3, '0');
    const used = new Set((taken || []).map((id) => String(id).toLowerCase()));
    if (!used.has(base)) return base;
    for (let n = 2; n < 100; n++) {
        const candidate = `${base}${n}`;
        if (!used.has(candidate)) return candidate;
    }
    return '';
};
