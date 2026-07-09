// src/utils/estimateDraft.js
// 見積書フォームの入力内容を localStorage へ自動退避／復元するユーティリティ。
//
// 目的: 明細は最大300行あり、入力に時間がかかる。保存前のブラウザクラッシュ・
//       誤操作・タブ誤閉じで全損しないよう、入力途中の header/items を
//       ブラウザローカルに退避しておき、次回フォームを開いた際に復元を提案する。
//
// 保存キーは見積IDごとに分離する（新規は 'new'）。
// DBへ保存が成功した時点で退避データは破棄する。

const KEY_PREFIX = 'estimate-draft:';
const SCHEMA_VERSION = 1;

// 退避データの有効期限（これより古い退避は復元候補にしない）
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7日

// 見積IDから localStorage キーを生成（新規作成時は 'new'）
const draftKey = (estimateId) => `${KEY_PREFIX}${estimateId ?? 'new'}`;

// 入力内容を退避する。失敗（QuotaExceeded・localStorage無効等）は握りつぶす
// —— 退避はベストエフォートであり、失敗してDB保存フローを妨げてはならない。
export const saveEstimateDraft = (estimateId, { header, items }) => {
  try {
    const payload = {
      version: SCHEMA_VERSION,
      savedAt: Date.now(),
      header,
      items,
    };
    localStorage.setItem(draftKey(estimateId), JSON.stringify(payload));
  } catch {
    // localStorage が使えない／容量超過などは無視（beforeunload警告が最終防衛線）
  }
};

// 退避データを読み込む。無い／壊れている／古い／スキーマ不一致なら null。
// 返り値: { header, items, savedAt } | null
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
    if (!parsed.header || !Array.isArray(parsed.items)) return null;

    return { header: parsed.header, items: parsed.items, savedAt: parsed.savedAt };
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
