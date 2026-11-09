import { describe, it, expect } from 'vitest';
import { kanaToRomaji, suggestLoginId } from './kanaToRomaji';
import { isValidLoginId } from './loginId';

describe('kanaToRomaji', () => {
    it('カタカナ・ひらがなをヘボン式にする', () => {
        expect(kanaToRomaji('タナカ')).toBe('tanaka');
        expect(kanaToRomaji('すずき')).toBe('suzuki');
        expect(kanaToRomaji('フジ')).toBe('fuji');
        expect(kanaToRomaji('ツチヤ')).toBe('tsuchiya');
    });

    it('長音を省く', () => {
        expect(kanaToRomaji('サトウ')).toBe('sato');
        expect(kanaToRomaji('オオクボ')).toBe('okubo');
        expect(kanaToRomaji('ユウキ')).toBe('yuki');
        expect(kanaToRomaji('コーイチ')).toBe('koichi');
    });

    it('拗音', () => {
        expect(kanaToRomaji('キョウコ')).toBe('kyoko');
        expect(kanaToRomaji('シュンスケ')).toBe('shunsuke');
        expect(kanaToRomaji('チャコ')).toBe('chako');
        expect(kanaToRomaji('ジュン')).toBe('jun');
        expect(kanaToRomaji('リョウ')).toBe('ryo');
    });

    it('促音', () => {
        expect(kanaToRomaji('ハットリ')).toBe('hattori');
        expect(kanaToRomaji('マッチ')).toBe('matchi');
        expect(kanaToRomaji('ホッカイ')).toBe('hokkai');
    });

    it('半角カナ・かな以外の文字', () => {
        expect(kanaToRomaji('ﾔﾏﾀﾞ')).toBe('yamada');
        expect(kanaToRomaji('山田')).toBe('');
    });
});

describe('suggestLoginId', () => {
    it('姓_名の頭文字', () => {
        expect(suggestLoginId('サトウ カツヨシ')).toBe('sato_k');
        expect(suggestLoginId('タナカ　タロウ')).toBe('tanaka_t'); // 全角スペース
    });

    it('使われていれば番号を付ける', () => {
        expect(suggestLoginId('サトウ カツヨシ', ['sato_k'])).toBe('sato_k2');
        expect(suggestLoginId('サトウ カツヨシ', ['sato_k', 'SATO_K2'])).toBe('sato_k3');
    });

    it('名が無ければ姓だけ。短ければ3文字にそろえる', () => {
        expect(suggestLoginId('スズキ')).toBe('suzuki');
        expect(suggestLoginId('イ')).toBe('i00');
    });

    it('フリガナが無い・かなでなければ空', () => {
        expect(suggestLoginId('')).toBe('');
        expect(suggestLoginId(null)).toBe('');
        expect(suggestLoginId('山田 太郎')).toBe('');
    });

    it('候補はログインIDの形式を満たす', () => {
        for (const kana of ['サトウ カツヨシ', 'ハセガワ ジュンイチロウ', 'イ', 'チョウソカベ モトチカ']) {
            expect(isValidLoginId(suggestLoginId(kana))).toBe(true);
        }
    });
});
