/**
 * 作業員アプリの「未送信の日報下書き（ドラフト）キュー」の同一性判定と絞り込み。
 *
 * 作業員が日報を書いている途中の内容は、現場（プロジェクト）×日付 の単位で
 * localStorage のキューに積まれる。積む契機は2つある:
 *   1. 入力中の自動保存（1秒デバウンス）  … `isAutoSaved: true`
 *   2. 送信時の通信エラーによる退避       … `isAutoSaved` なし
 *
 * もともと同じ「現場+日付 が同一か」の判定が4箇所で**別々に書かれていた**:
 *   - `offlineCache.js` の `draftKey`（テンプレートリテラル連結）
 *   - `WorkerApp.jsx` の自動保存の重複排除（同じ連結を再度べた書き）
 *   - `WorkerApp.jsx` の送信失敗時の重複排除（さらにもう1回べた書き）
 *   - `WorkerApp.jsx` の `notifiableDraftQueue`（`String()` 比較＋日付の直接比較）
 *
 * id が数値と文字列で混ざる（Supabase は数値、localStorage 往復後は文字列）ため、
 * この4つは**同じ入力に対して違う答えを返し得た**。ここを唯一の持ち主にする。
 */

/** キューに積まれる下書き1件。tasks 等の中身はここでは関知しない。 */
export interface DraftLike {
    selectedProjectId: string | number;
    selectedDate: string;
    /** 入力中の自動保存で積まれたものだけ true */
    isAutoSaved?: boolean;
    [key: string]: unknown;
}

/**
 * 現場+日付 からキューの同一性キーを作る。
 *
 * `String()` に寄せるのが要点。localStorage を往復すると
 * `selectedProjectId` は数値 `12` から文字列 `'12'` に変わるため、
 * 素の連結でも実際は一致するが、呼び出し側が `Number` を渡すか
 * `String` を渡すかに依存しない形に固定しておく。
 *
 * ⚠️ 制約: 区切りを2文字にしても境界の曖昧さは消えない。
 * `draftKey('1_', 'X')` と `draftKey('1', '_X')` はどちらも `'1___X'` になる。
 * 固定の区切り文字を選ぶ限りこれは避けられない。
 * 実運用では id は数値、日付は `'YYYY-MM-DD'` 固定なので衝突しないが、
 * 任意文字列を入れる用途に広げるときはここを作り直すこと。
 */
export const draftKey = (
    projectId: string | number | null | undefined,
    date: string | null | undefined
): string => `${String(projectId)}__${String(date)}`;

/** 下書き1件からキューの同一性キーを作る。 */
export const draftKeyOf = (draft: DraftLike): string =>
    draftKey(draft?.selectedProjectId, draft?.selectedDate);

/** 下書きが指定の 現場+日付 のものか。 */
export const isSameDraftTarget = (
    draft: DraftLike,
    projectId: string | number | null | undefined,
    date: string | null | undefined
): boolean => draftKeyOf(draft) === draftKey(projectId, date);

/**
 * キューに下書きを追加、または同一 現場+日付 のものを上書きする純粋関数。
 * 元の配列は破壊しない。上書き時も**位置は元のまま**（通知の並びが飛ばないように）。
 */
export const upsertIntoQueue = <T extends DraftLike>(queue: T[], entry: T): T[] => {
    const key = draftKeyOf(entry);
    const list = queue || [];
    const idx = list.findIndex(d => draftKeyOf(d) === key);
    if (idx < 0) return [...list, entry];
    const next = [...list];
    next[idx] = entry;
    return next;
};

/** キューから指定の 現場+日付 の下書きを取り除く純粋関数。元の配列は破壊しない。 */
export const removeFromQueue = <T extends DraftLike>(
    queue: T[],
    projectId: string | number | null | undefined,
    date: string | null | undefined
): T[] => {
    const key = draftKey(projectId, date);
    return (queue || []).filter(d => draftKeyOf(d) !== key);
};

/**
 * ユーザーに「未送信があります」と通知すべき下書きだけに絞る。
 *
 * 今まさに編集中の 現場+日付 の**自動保存**は、ユーザーが画面で見ている内容そのものなので
 * 通知しない（毎秒「未送信1件」と出てしまう）。
 * 一方、同じ 現場+日付 でも**通信エラーで退避されたもの**は、
 * 送信できていない事実を伝える必要があるので通知する。
 */
export const selectNotifiableDrafts = <T extends DraftLike>(
    queue: T[],
    selectedProjectId: string | number | null | undefined,
    selectedDate: string | null | undefined
): T[] => {
    const currentKey = draftKey(selectedProjectId, selectedDate);
    return (queue || []).filter(d => !d.isAutoSaved || draftKeyOf(d) !== currentKey);
};
