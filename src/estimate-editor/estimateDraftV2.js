// src/estimate-editor/estimateDraftV2.js
// 見積WYSIWYGエディタの入力内容を localStorage へ自動退避／復元するユーティリティ。
//
// 目的: 明細は最大300行あり、入力に時間がかかる。保存前のブラウザクラッシュ・
//       誤操作・タブ誤閉じで全損しないよう、入力途中の header/sheets/items を
//       ブラウザローカルに退避しておき、次回エディタを開いた際に復元を提案する。
//
// v1（src/utils/estimateDraft.js）との違い:
//   - キー接頭辞を 'estimate-draft-v2:' に分離（旧フォームの退避と衝突させない）
//   - payload に sheets（シート配列）を追加し、スキーマバージョンを 2 に更新
//
// 保存キーは見積IDごとに分離する（新規は 'new'）。
// DBへ保存が成功した時点で退避データは破棄する。

const KEY_PREFIX = 'estimate-draft-v2:';
const SCHEMA_VERSION = 2;

// 退避データの有効期限（これより古い退避は復元候補にしない）
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7日

// 見積IDから localStorage キーを生成（新規作成時は 'new'）
const draftKey = (estimateId) => `${KEY_PREFIX}${estimateId ?? 'new'}`;

// 入力内容を退避する。失敗（QuotaExceeded・localStorage無効等）は握りつぶす
// —— 退避はベストエフォートであり、失敗してDB保存フローを妨げてはならない。
export const saveEstimateDraft = (estimateId, { header, sheets, items }) => {
  try {
    const payload = {
      version: SCHEMA_VERSION,
      savedAt: Date.now(),
      header,
      sheets,
      items,
    };
    localStorage.setItem(draftKey(estimateId), JSON.stringify(payload));
  } catch {
    // localStorage が使えない／容量超過などは無視（beforeunload警告が最終防衛線）
  }
};

// 退避データを読み込む。無い／壊れている／古い／スキーマ不一致なら null。
// 返り値: { header, sheets, items, savedAt } | null
export const loadEstimateDraft = (estimateId) => {
  try {
    const raw = localStorage.getItem(draftKey(estimateId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SCHEMA_VERSION) return null;
    if (typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      // 期限切れは掃除しておく
      clearEstimateDraft(estimateId);
      return null;
    }
    if (!parsed.header || !Array.isArray(parsed.sheets) || !Array.isArray(parsed.items)) return null;

    return { header: parsed.header, sheets: parsed.sheets, items: parsed.items, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
};

// 退避データを破棄する（DB保存成功時・破棄離脱時に呼ぶ）
export const clearEstimateDraft = (estimateId) => {
  try {
    localStorage.removeItem(draftKey(estimateId));
  } catch {
    // 無視
  }
};

// 退避時刻を「◯分前」等の相対表記にして復元プロンプトに表示する
export const formatDraftAge = (savedAt) => {
  const diffMs = Date.now() - savedAt;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}日前`;
};

// ------------------------------------------------------------------
// 「直前の保存内容」スナップショット（保存後の誤上書き・誤削除からの救済用）
//
// 上の自動退避（draft）はDB保存が成功すると即座に破棄される（clearEstimateDraft）ため、
// 「保存はしたが、その後に明細を誤って上書き・削除した」場合に戻す先が無い。
// これを補うため、DB保存成功のたびに直近1世代分だけ header/sheets/items を
// 別キーに退避しておき、エディタ側から手動で復元できるようにする。
// あくまでこのブラウザ・この端末内の簡易な救済であり、正式な変更履歴（サーバー側）ではない。
// ------------------------------------------------------------------

const LAST_SAVED_KEY_PREFIX = 'estimate-last-saved:';
const LAST_SAVED_SCHEMA_VERSION = 1;

// 直前の保存内容を保持する期間（これを過ぎたら復元候補にしない）
const LAST_SAVED_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3日

const lastSavedKey = (estimateId) => `${LAST_SAVED_KEY_PREFIX}${estimateId ?? 'new'}`;

// DB保存が成功した直後に呼ぶ。保存に使った内容をそのまま退避する。
export const saveLastSavedSnapshot = (estimateId, { header, sheets, items }) => {
  try {
    const payload = {
      version: LAST_SAVED_SCHEMA_VERSION,
      savedAt: Date.now(),
      header,
      sheets,
      items,
    };
    localStorage.setItem(lastSavedKey(estimateId), JSON.stringify(payload));
  } catch {
    // ベストエフォート。失敗しても保存フロー自体は成功扱いのまま進める。
  }
};

// 直前の保存内容を読み込む。無い／壊れている／期限切れならnull。
export const loadLastSavedSnapshot = (estimateId) => {
  try {
    const raw = localStorage.getItem(lastSavedKey(estimateId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== LAST_SAVED_SCHEMA_VERSION) return null;
    if (typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > LAST_SAVED_MAX_AGE_MS) {
      clearLastSavedSnapshot(estimateId);
      return null;
    }
    if (!parsed.header || !Array.isArray(parsed.sheets) || !Array.isArray(parsed.items)) return null;

    return { header: parsed.header, sheets: parsed.sheets, items: parsed.items, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
};

// 保存済みIDが確定した直後（新規作成時など）にキーを付け替えるためのヘルパー
export const clearLastSavedSnapshot = (estimateId) => {
  try {
    localStorage.removeItem(lastSavedKey(estimateId));
  } catch {
    // 無視
  }
};
