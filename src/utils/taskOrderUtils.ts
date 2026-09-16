/**
 * 作業員アプリの「作業項目タイルの並び順」の永続化と適用。
 *
 * 作業員は日報入力画面で作業項目タイルを長押しドラッグして並び替えられる。
 * 並び順は現場（プロジェクト）ごとに localStorage へ保存され、次回以降も復元される。
 *
 * もともと `WorkerApp.jsx` の先頭にべた書きされていて、
 *   - 保存順に無い項目（後から追加された作業）の扱い
 *   - id の型が数値と文字列で混ざること
 *   - 壊れた localStorage の値
 * といった間違えやすい点が一切テストされていなかったため切り出した。
 *
 * 並べ替えそのもの（`sortByOrder`）は localStorage に触らない純粋関数なので、
 * ストレージ入出力と分けてテストできるようにしてある。
 */

/** id を持っていれば並べ替えられる。日報の作業項目はこれを満たす。 */
export interface OrderableItem {
    id: string | number;
}

/** 現場ごとに並び順を分けて保存するための localStorage キー。 */
export const taskOrderStorageKey = (projectId: string | number): string =>
    `cost-app-worker-task-order-${projectId}`;

/**
 * 保存済みの並び順（idの配列）を localStorage から読む。
 * 未保存・壊れている・localStorage が使えない（プライベートモード等）場合は null。
 */
export const loadSavedTaskOrder = (
    projectId: string | number | null | undefined
): string[] | null => {
    if (!projectId) return null;
    try {
        const raw = localStorage.getItem(taskOrderStorageKey(projectId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
        return null;
    }
};

/**
 * 保存済みの並び順（idの配列）で安定ソートする純粋関数。
 *
 * - 保存順に無い項目（新規追加された作業など）は元の相対順を保ったまま末尾に回す
 * - id は数値と文字列が混ざるので String() に寄せて比較する
 * - 元の配列は破壊しない
 *
 * `savedOrder` が空・null なら何もせず元の配列をそのまま返す。
 */
export const sortByOrder = <T extends OrderableItem>(
    items: T[],
    savedOrder: string[] | null
): T[] => {
    if (!items) return items;
    if (!savedOrder || savedOrder.length === 0) return items;

    const rank = new Map(savedOrder.map((id, i) => [id, i]));
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const ra = rank.has(String(a.item.id))
                ? (rank.get(String(a.item.id)) as number)
                : Number.MAX_SAFE_INTEGER;
            const rb = rank.has(String(b.item.id))
                ? (rank.get(String(b.item.id)) as number)
                : Number.MAX_SAFE_INTEGER;
            if (ra !== rb) return ra - rb;
            return a.index - b.index; // 同順位は元の順序を維持（安定ソート）
        })
        .map(({ item }) => item);
};

/** 保存済みの並び順を読み込んで適用する。`sortByOrder` に localStorage 読み込みを足しただけ。 */
export const applyTaskOrder = <T extends OrderableItem>(
    items: T[],
    projectId: string | number | null | undefined
): T[] => sortByOrder(items, loadSavedTaskOrder(projectId));

/**
 * 現在の並び順（idの配列）を localStorage に保存する。
 * 保存に失敗しても画面上の並び替え自体は有効なので、黙って無視する。
 */
export const saveTaskOrder = (
    items: OrderableItem[],
    projectId: string | number | null | undefined
): void => {
    if (!projectId) return;
    try {
        localStorage.setItem(
            taskOrderStorageKey(projectId),
            JSON.stringify((items || []).map(t => String(t.id)))
        );
    } catch {
        // 保存に失敗しても並び替え自体は有効なので黙って無視する
    }
};
