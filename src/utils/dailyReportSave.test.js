import { describe, it, expect } from 'vitest';
import {
    newClientUuid, isNetworkSaveError, describeSaveError, isConflictError, buildExpectedVersions, buildProgressPayload,
} from './dailyReportSave';

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

describe('楽観ロック（docs/specs/daily-report-db-hardening.md §4.5・4.6）', () => {
    const conflict = { code: 'PT409', message: '他の人が先にこの日報か進捗を直しました。読み込み直してから、もう一度入力してください。' };

    it('競合は理由をそのまま見せ、電波の案内にしない', () => {
        const text = describeSaveError(conflict);
        expect(text).toContain('他の人が先に');
        expect(text).not.toContain('電波');
        expect(describeSaveError({ code: 'PT409', message: '申請の内容が変わりました。' }, { action: '承認' }))
            .toBe('承認できませんでした: 申請の内容が変わりました。');
    });

    it('isConflictError は PT409 だけを競合とみなす', () => {
        expect(isConflictError(conflict)).toBe(true);
        expect(isConflictError({ code: '22023' })).toBe(false);
        expect(isConflictError(null)).toBe(false);
    });

    it('buildExpectedVersions は版の分かる行だけを入れ、id を文字列のキーにする', () => {
        const versions = new Map([['10', '2026-11-20T01:00:00.123456+00:00'], ['11', '2026-11-20T02:00:00+00:00']]);
        expect(buildExpectedVersions([10, '11', 12], versions)).toEqual({
            10: '2026-11-20T01:00:00.123456+00:00',
            11: '2026-11-20T02:00:00+00:00',
        });
        expect(buildExpectedVersions([], versions)).toEqual({});
    });

    it('buildProgressPayload は変えた作業項目だけを、読み込んだときの値と一緒に送る', () => {
        const tasks = [
            { id: 1, progress_percentage: 50, saved_progress: 30 },  // 変えた
            { id: 2, progress_percentage: 30, saved_progress: 30 },  // 変えていない
            { id: 3, progress_percentage: 0, saved_progress: null }, // DB が NULL で画面は 0（変えていない）
            { id: 4, progress_percentage: 10, saved_progress: null }, // DB が NULL から変えた
        ];
        expect(buildProgressPayload(tasks)).toEqual([
            { id: 1, progress_percentage: 50, expected_progress: 30 },
            { id: 4, progress_percentage: 10, expected_progress: null },
        ]);
    });

    it('読み込んだときの値を持たない作業項目（古い下書きなど）は、比べずに送る', () => {
        expect(buildProgressPayload([{ id: 5, progress_percentage: 40 }]))
            .toEqual([{ id: 5, progress_percentage: 40 }]);
    });
});
