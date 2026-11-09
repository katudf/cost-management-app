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
    /**
     * 下書きを書いた作業員名。作業員は共有アカウントで名前を選んでログインするため、
     * 1台の端末を複数人で使うと他人の下書きを復元・送信できてしまう。これで持ち主を区別する。
     * 2026-11 より前に保存された下書きには無い。
     */
    workerName?: string;
    /**
     * 下書きを書いた作業員の ID（docs/specs/worker-login.md §4.2）。名前の変更や同名の別人で
     * 持ち主を取り違えないよう、絞り込みはこれを優先する。2026-11-07 より前に保存された下書きには無い。
     */
    workerId?: string | number | null;
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
    date: string | null | undefined,
    workerName?: string | null,
    workerId?: string | number | null
): string => {
    // 作業員 ID があれば ID で持ち主を表す（同じ名前の別人の下書きを上書きしない。docs/specs/worker-login.md §4.2）
    if (hasId(workerId)) return `${String(projectId)}__${String(date)}__#${String(workerId)}`;
    return `${String(projectId)}__${String(date)}${workerName ? `__${workerName}` : ''}`;
};

const hasId = (id: unknown): boolean => id != null && id !== '';

/** 下書き1件からキューの同一性キーを作る。 */
export const draftKeyOf = (draft: DraftLike): string =>
    draftKey(draft?.selectedProjectId, draft?.selectedDate, draft?.workerName, draft?.workerId);

/**
 * 下書きがこの作業員のものか。下書きと呼び出し側の両方に ID があれば ID で、なければ名前で比べる
 * （ID の無い古い下書きは名前で。名前も無い下書き同士は同じ持ち主とみなす）。
 */
export const isWorkerDraft = (
    draft: DraftLike,
    workerName: string | null | undefined,
    workerId?: string | number | null
): boolean => {
    if (hasId(draft?.workerId) && hasId(workerId)) return String(draft.workerId) === String(workerId);
    return (draft?.workerName || '') === (workerName || '');
};

/** 下書きが指定の 作業員+現場+日付 のものか。 */
export const isSameDraftTarget = (
    draft: DraftLike,
    projectId: string | number | null | undefined,
    date: string | null | undefined,
    workerName?: string | null,
    workerId?: string | number | null
): boolean => String(draft?.selectedProjectId) === String(projectId)
    && String(draft?.selectedDate) === String(date)
    && isWorkerDraft(draft, workerName, workerId);

/**
 * 指定の作業員が書いた下書きだけに絞る。
 * 作業員名を持たない古い下書きは、誰のものか判別できないため誰にも見せない
 * （他人の日報として復元・送信される事故を防ぐ）。
 * ID を持つ下書きは ID で比べる（名前を変えても自分の下書きが見え、同名の別人の下書きは見えない）。
 */
export const selectWorkerDrafts = <T extends DraftLike>(
    queue: T[],
    workerName: string | null | undefined,
    workerId?: string | number | null
): T[] => (workerName || hasId(workerId)
    ? (queue || []).filter(d => (d.workerName || hasId(d.workerId)) && isWorkerDraft(d, workerName, workerId))
    : []);

/**
 * キューに下書きを追加、または同一 作業員+現場+日付 のものを上書きする純粋関数。
 * 元の配列は破壊しない。上書き時も**位置は元のまま**（通知の並びが飛ばないように）。
 * ID の無い古い同じ人の下書き（名前が一致）も、ID 付きの新しい下書きで上書きする。
 */
export const upsertIntoQueue = <T extends DraftLike>(queue: T[], entry: T): T[] => {
    const list = queue || [];
    const idx = list.findIndex(d => isSameDraftTarget(d, entry?.selectedProjectId, entry?.selectedDate, entry?.workerName, entry?.workerId));
    if (idx < 0) return [...list, entry];
    const next = [...list];
    next[idx] = entry;
    return next;
};

/** キューから指定の 作業員+現場+日付 の下書きを取り除く純粋関数。元の配列は破壊しない。 */
export const removeFromQueue = <T extends DraftLike>(
    queue: T[],
    projectId: string | number | null | undefined,
    date: string | null | undefined,
    workerName?: string | null,
    workerId?: string | number | null
): T[] => (queue || []).filter(d => !isSameDraftTarget(d, projectId, date, workerName, workerId));

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
    selectedDate: string | null | undefined,
    workerName?: string | null,
    workerId?: string | number | null
): T[] => (queue || []).filter(d => !d.isAutoSaved || !isSameDraftTarget(d, selectedProjectId, selectedDate, workerName, workerId));
