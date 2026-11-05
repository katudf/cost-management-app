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
