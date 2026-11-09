/**
 * 配置表の人工（消化人工・目標人工）の画面状態を扱う純粋な関数。
 * 状態の形: { [projectId]: { consumedNinku: number, targetNinku: number|null } }
 */

/** 目標人工を書き換えた新しい状態を返す（消化人工は保つ。未取得の現場は消化0として作る） */
export function applyTargetNinku(map, projectId, targetNinku) {
    return {
        ...map,
        [projectId]: { consumedNinku: map[projectId]?.consumedNinku ?? 0, targetNinku }
    };
}

/** 保存に失敗したとき、その現場だけ元の値（元が無ければ削除）に戻した新しい状態を返す */
export function restoreNinkuEntry(map, projectId, previous) {
    const next = { ...map };
    if (previous) next[projectId] = previous;
    else delete next[projectId];
    return next;
}

/**
 * 「最後に始めた取得の応答だけを使う」ための番号札。
 * start() で番号を受け取り、応答が来たら isLatest(番号) で古い応答を捨てる。
 * invalidate() は取得中の応答をすべて古い扱いにする（目標を保存した直後など）。
 */
export function createLatestGuard() {
    let seq = 0;
    return {
        start: () => ++seq,
        isLatest: (n) => n === seq,
        invalidate: () => { seq += 1; }
    };
}
