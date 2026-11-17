// src/estimate-editor/editHistory.js
// 見積エディタの「元に戻す／やり直し」履歴（純関数）。
//
// 履歴の1件（entry）は「その操作を行う直前の { header, sheets, items }」を丸ごと持つ。
//   { id, snapshot, label, key, focus }
//   - label : ボタンのツールチップ・通知に出す操作名（例: '行の削除'）
//   - key   : 連続入力をまとめるためのキー（例: 'cell:<uid>:name'）。null ならまとめない
//   - focus : 戻した後にカーソルを移すセル { uid, col }（無ければ null）
//
// 状態: { past: entry[], future: entry[], lastKey: string|null }
//   lastKey は「直前に積んだ操作のまとめキー」。別セルへ移動した・保存した等で null に戻し、
//   次の入力を新しい1件として積む。

export const HISTORY_LIMIT = 100;

// 戻しても現在値を維持するヘッダー項目（サーバー側で確定するステータス・承認・案件連携）。
// 自動退避の復元（handleRestoreDraft）と同じ考え方で、編集データの履歴とは切り離す。
export const SERVER_MANAGED_HEADER_FIELDS = [
  'status',
  'approved_by',
  'approved_at',
  'returned_reason',
  'approver_staff_id',
  'project_id',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let entrySeq = 0;
const nextEntryId = () => `h${++entrySeq}`;

export const createHistory = () => ({ past: [], future: [], lastKey: null });

/**
 * 操作直前の状態を積む。key が直前の操作と同じなら（同じセルへの連続入力）積まずにまとめる。
 * 戻り値: { history, entry|null }（entry は新しく積んだときだけ返す）
 */
export const pushEntry = (history, { snapshot, label, key = null, focus = null }, limit = HISTORY_LIMIT) => {
  if (key != null && key === history.lastKey && history.past.length > 0) {
    return { history, entry: null };
  }
  const entry = { id: nextEntryId(), snapshot, label, key, focus };
  const past = [...history.past, entry];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { history: { past, future: [], lastKey: key }, entry };
};

/** 連続入力のまとめを打ち切る（別セルへ移動・保存など） */
export const breakCoalesce = (history) =>
  history.lastKey == null ? history : { ...history, lastKey: null };

/**
 * 1つ戻す。current は現在の { header, sheets, items }。
 * 戻り値: { history, entry }（entry.snapshot が復元すべき状態）。戻せなければ null。
 */
export const undoHistory = (history, current) => {
  if (history.past.length === 0) return null;
  const entry = history.past[history.past.length - 1];
  const redoEntry = { ...entry, id: nextEntryId(), snapshot: current };
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, redoEntry],
      lastKey: null,
    },
    entry,
  };
};

/** 1つやり直す。undoHistory と対称。 */
export const redoHistory = (history, current) => {
  if (history.future.length === 0) return null;
  const entry = history.future[history.future.length - 1];
  const undoEntry = { ...entry, id: nextEntryId(), snapshot: current };
  return {
    history: {
      past: [...history.past, undoEntry],
      future: history.future.slice(0, -1),
      lastKey: null,
    },
    entry,
  };
};

// スナップショット内のシートIDを置き換える（sheets[].id / items[].sheet_id / items[].linked_sheet_id）
const remapSnapshotSheetIds = (snapshot, idMap) => {
  if (!idMap || idMap.size === 0) return snapshot;
  const re = (id) => (id != null && idMap.has(id) ? idMap.get(id) : id);
  return {
    ...snapshot,
    sheets: snapshot.sheets.map(s => (idMap.has(s.id) ? { ...s, id: re(s.id) } : s)),
    items: snapshot.items.map(it => {
      const sheetId = re(it.sheet_id);
      const linkedSheetId = re(it.linked_sheet_id);
      return sheetId === it.sheet_id && linkedSheetId === it.linked_sheet_id
        ? it
        : { ...it, sheet_id: sheetId, linked_sheet_id: linkedSheetId };
    }),
  };
};

/**
 * 保存で仮シートIDが確定IDに置き換わったとき、履歴内のスナップショットにも同じ置換を当てる。
 * （そうしないと保存前の状態に戻した際、同じシートが「新規シート」として作り直される）
 */
export const remapHistorySheetIds = (history, idMap) => {
  if (!idMap || idMap.size === 0) return history;
  const remap = (e) => ({ ...e, snapshot: remapSnapshotSheetIds(e.snapshot, idMap) });
  return { ...history, past: history.past.map(remap), future: history.future.map(remap) };
};

/**
 * 履歴のスナップショットを画面に戻す形へ整える。
 * - ヘッダーのサーバー管理項目（ステータス・承認・案件連携）は現在値を維持する
 * - DB上に既に無い保存済みシートID（例: シート削除→保存→元に戻す）は新しい仮IDへ振り替える。
 *   そのまま保存すると存在しないシートを参照して保存が失敗するため。
 *
 * @param snapshot       戻す先の { header, sheets, items }
 * @param currentHeader  現在のヘッダー
 * @param knownSheetIds  DB上に現存するシートIDの Set
 * @param newSheetId     仮シートIDの採番関数
 */
export const prepareSnapshotForRestore = (snapshot, currentHeader, knownSheetIds, newSheetId) => {
  const header = { ...snapshot.header };
  SERVER_MANAGED_HEADER_FIELDS.forEach(f => { header[f] = currentHeader[f]; });

  const idMap = new Map();
  snapshot.sheets.forEach(s => {
    if (UUID_RE.test(String(s.id ?? '')) && !knownSheetIds.has(s.id)) {
      idMap.set(s.id, newSheetId());
    }
  });
  const remapped = remapSnapshotSheetIds(snapshot, idMap);
  // 必ず新しい配列を返す（同一参照だと React の変更検知が働かず、復元中フラグが解除されない）
  return { header, sheets: [...remapped.sheets], items: [...remapped.items] };
};

// ============================================================
// 履歴コントローラー（React 非依存。useEditHistory が薄く包む）
// ------------------------------------------------------------
// 各編集操作は edit(操作名, opts, producer) を呼ぶ。producer は「現在の状態」から
// 変更後の部分状態 { header?, sheets?, items? } を同期的に計算して返す（変化なしは null）。
// 履歴への追加と状態の反映を同じ呼び出しの中で行うため、描画タイミングに左右されない。
// ============================================================
const sameState = (a, b) =>
  !!a && !!b && a.header === b.header && a.sheets === b.sheets && a.items === b.items;

/**
 * @param apply      (nextState, prevState) => void  画面の状態へ反映する（変わった部分だけ set する）
 * @param newSheetId 仮シートIDの採番関数
 * @param onView     ({ undoLabel, redoLabel }) => void  ボタン表示の更新
 */
export const createHistoryController = ({ apply, newSheetId, onView = () => {}, limit = HISTORY_LIMIT }) => {
  let history = createHistory();
  let latest = null;          // 画面の最新状態 { header, sheets, items }
  let lastEditResult = null;  // 直前の edit が作った状態（以後に別の変化があればまとめを打ち切る）
  let knownSheetIds = new Set();

  const publish = () => {
    const top = history.past[history.past.length - 1];
    const redoTop = history.future[history.future.length - 1];
    onView({ undoLabel: top?.label ?? null, redoLabel: redoTop?.label ?? null });
  };

  const setState = (next) => {
    const prev = latest;
    latest = next;
    apply(next, prev);
  };

  const api = {
    /** 描画ごとに画面の最新状態を渡す（保存・読み込みなど edit 以外の変化を取り込む） */
    sync(state) {
      if (sameState(state, latest)) return;
      latest = state;
    },

    /** 編集操作。履歴に積んだ entry を返す（同じ欄への連続入力でまとめた場合・変化なしは null） */
    edit(label, { key = null, focus = null } = {}, producer) {
      if (!latest) return null;
      const patch = producer(latest);
      if (!patch) return null;
      const next = { ...latest, ...patch };
      if (sameState(next, latest)) return null;
      // 前回の edit の後に保存などの別の変化があれば、同じ欄でも新しい1件にする
      if (!sameState(latest, lastEditResult)) history = breakCoalesce(history);
      const res = pushEntry(history, { snapshot: latest, label, key, focus }, limit);
      history = res.history;
      setState(next);
      lastEditResult = next;
      publish();
      return res.entry;
    },

    undo() {
      if (!latest) return null;
      const res = undoHistory(history, latest);
      if (!res) return null;
      history = res.history;
      setState(prepareSnapshotForRestore(res.entry.snapshot, latest.header, knownSheetIds, newSheetId));
      lastEditResult = null;
      publish();
      return res.entry;
    },

    redo() {
      if (!latest) return null;
      const res = redoHistory(history, latest);
      if (!res) return null;
      history = res.history;
      setState(prepareSnapshotForRestore(res.entry.snapshot, latest.header, knownSheetIds, newSheetId));
      lastEditResult = null;
      publish();
      return res.entry;
    },

    /** 指定の操作が今も直近の操作であるときだけ戻す（通知の「元に戻す」用） */
    undoIfTop(entryId) {
      const top = history.past[history.past.length - 1];
      if (!top || top.id !== entryId) return null;
      return api.undo();
    },

    clear() {
      history = createHistory();
      lastEditResult = null;
      publish();
    },

    breakCoalesce() {
      history = breakCoalesce(history);
    },

    setKnownSheetIds(ids) {
      knownSheetIds = new Set((ids || []).filter(Boolean));
    },

    remapSheetIds(idMap) {
      history = remapHistorySheetIds(history, idMap);
    },
  };
  return api;
};
