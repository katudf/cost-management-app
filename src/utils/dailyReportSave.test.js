import { describe, it, expect } from 'vitest';
import { newClientUuid, isNetworkSaveError, describeSaveError } from './dailyReportSave';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('newClientUuid', () => {
    it('DB 側の判定と同じ UUID 形式を返す', () => {
        expect(newClientUuid()).toMatch(UUID_RE);
        expect(newClientUuid()).not.toBe(newClientUuid());
    });
});

describe('isNetworkSaveError', () => {
    it('オフラインまたは fetch 失敗は通信エラー', () => {
        expect(isNetworkSaveError({ message: 'x' }, false)).toBe(true);
        expect(isNetworkSaveError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    });
    it('DB 関数のエラーは通信エラーではない', () => {
        expect(isNetworkSaveError({ code: '42501', message: '進捗と協力業者はこの現場の職長のみ登録できます。' })).toBe(false);
    });
});

describe('describeSaveError', () => {
    it('権限エラーは理由を見せ、電波の案内にしない', () => {
        const text = describeSaveError({ code: '42501', message: '進捗と協力業者はこの現場の職長のみ登録できます。' });
        expect(text).toContain('職長のみ');
        expect(text).not.toContain('電波');
    });
    it('一意制約違反は時刻の重複として案内する', () => {
        expect(describeSaveError({ code: '23505', message: 'duplicate key' })).toContain('開始時刻');
    });
    it('不明なエラーは従来の案内', () => {
        expect(describeSaveError({ message: 'boom' })).toContain('電波');
    });
});

describe('describeSaveError（保存以外の操作）', () => {
    it('action を渡すと「〇〇できませんでした」の文言になる', () => {
        expect(describeSaveError({ code: '22023', message: 'この残業申請は承認待ちではありません。' }, { action: '承認' }))
            .toBe('承認できませんでした: この残業申請は承認待ちではありません。');
    });

    it('DB が理由を返さないときは fallback を使う', () => {
        expect(describeSaveError({ code: 'XX000', message: 'boom' }, { action: '承認', fallback: '承認に失敗しました。' }))
            .toBe('承認に失敗しました。');
    });

    it('fallback が無ければ action から既定の文言を作る', () => {
        expect(describeSaveError(new Error('x'), { action: '承認' }))
            .toBe('承認に失敗しました。電波の良いところで再度お試しください。');
    });
});
