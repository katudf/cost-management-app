// src/estimate-editor/estimateCalc.js
// 見積WYSIWYGエディタ Phase 5: 計算・リンクエンジン（design.md §4/§5）。
//
// 責務: シート×明細のフラットモデルから、リンクを解決した「実効値」と
// 各種合計（カテゴリ小計・シート合計・税抜合計）を、シートをまたいで
// 一括計算する純関数。EstimateEditor が useMemo でこれを呼び、結果を
// SheetPaper / CoverPaper へ props で流す（SheetPaper 単体では別シートの
// 合計を知り得ないため、計算はエディタ側に集約する）。
//
// リンクは2種類（design.md §4）:
//   ① linked_sheet_id           … 別シートの合計 → 自行の単価に反映（③千歳橋型）。
//                                  摘要に「明細書No.n」を自動表示。
//   ② linked_category_item_id   … カテゴリ小計 → 自行の数量1.0式・単価・名称に反映
//                                  （②水沢中・総括表型）。
//
// リンクはシート合計 → 行単価 → 別シート合計 … と連鎖しうるため、依存関係を
// トポロジカル順に解決する。循環は検出してそのリンクを無効化し（値0扱い）、
// 巻き込まれた行/シートの id 集合を返して UI 側で警告表示できるようにする。

import { ITEM_TYPE } from '../utils/constants';

// 空行センチネル（SheetPaper と同値。空行は合計計算の対象外）
const BLANK_SENTINEL = '__blank__';

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

const isBlankRow = (item) =>
  item.category_symbol === BLANK_SENTINEL &&
  !item.name && !item.spec &&
  (item.quantity == null || item.quantity === '') &&
  (item.unit_price == null || item.unit_price === '');

// ============================================================
// computeEstimateCalc(sheets, items) → 計算結果
// ============================================================
// 引数:
//   sheets: [{ id, title }]                 表示順（[0]=トップシート）
//   items:  フラット配列（各行に sheet_id / _uid / item_type ほか）
// 返り値:
//   {
//     resolvedItems: items と同順・同数の配列。リンク行は unit_price/amount/
//                    quantity/unit/name/note（摘要）を実効値で上書き済み。
//                    非リンク行は amount を quantity×unit_price で補完。
//     sheetTotals:   Map<sheetId, number>   各シートの合計（トップ=税抜合計相当の
//                    明細部合計、サブ=合計）。FIXED は含めない（鑑側で別途加算）。
//     catTotals:     Map<categoryItemId, number>  カテゴリ id → 小計（②の参照元）。
//                    id 未確定の新規カテゴリは _tempId でも引けるよう両方をキーにする。
//     cycleUids:     Set<_uid>              循環参照で無効化された行の _uid。
//   }
// ============================================================
export const computeEstimateCalc = (sheets, items) => {
  const sheetOrder = new Map((sheets || []).map((s, i) => [s.id, i])); // sheetId → 0基底index

  // --- カテゴリ小計の元となる「所属カテゴリ」を各 ITEM 行に割り当てる ---
  // カテゴリ行が現れるたびに currentCat を更新し、以降の ITEM をそのカテゴリに束ねる。
  // カテゴリの識別キーは id（既存）優先、無ければ _tempId（新規）。
  const catKeyOf = (catItem) =>
    catItem == null ? null : (catItem.id != null ? `id:${catItem.id}` : `tmp:${catItem._tempId || catItem._uid}`);

  // シートごとに現在カテゴリを追跡（シートが変わればリセット）
  const itemCatKey = new Map(); // row._uid → 所属カテゴリキー
  const catItemsMap = new Map(); // カテゴリキー → { cat, memberUids:[] }
  {
    const perSheetCurrentCat = new Map();
    for (const row of items) {
      const sid = row.sheet_id;
      if (row.item_type === ITEM_TYPE.CATEGORY) {
        const key = catKeyOf(row);
        perSheetCurrentCat.set(sid, key);
        if (!catItemsMap.has(key)) catItemsMap.set(key, { cat: row, memberUids: [] });
      } else if (row.item_type === ITEM_TYPE.ITEM && !isBlankRow(row)) {
        const key = perSheetCurrentCat.get(sid) || null;
        if (key) {
          itemCatKey.set(row._uid, key);
          catItemsMap.get(key)?.memberUids.push(row._uid);
        }
      }
    }
  }

  // id / _tempId / _uid いずれからでもカテゴリキーを引けるようにする逆引き表。
  // ②のリンクは linked_category_item_id（既存の bigint id）で持つが、保存前の
  // 新規カテゴリを指す場合に備えて _tempId 参照も許容する。
  const catKeyByAnyRef = new Map();
  for (const [key, { cat }] of catItemsMap) {
    if (cat.id != null) catKeyByAnyRef.set(String(cat.id), key);
    if (cat._tempId != null) catKeyByAnyRef.set(String(cat._tempId), key);
    if (cat._uid != null) catKeyByAnyRef.set(String(cat._uid), key);
  }

  // --- 実効値の器（リンク解決で上書きする） ---
  // amount/unit_price/quantity/name/note を後で確定する。まずは素の値をコピー。
  const eff = new Map(); // row._uid → { unit_price, quantity, amount, name, note, unit }
  for (const row of items) {
    eff.set(row._uid, {
      unit_price: row.unit_price,
      quantity: row.quantity,
      amount: row.amount,
      name: row.name,
      note: row.note,
      unit: row.unit,
    });
  }

  // ============================================================
  // 依存解決（メモ化DFS＋循環検出）
  // ============================================================
  // 解決対象は「ノード」= シート合計（sheet:<id>）／カテゴリ小計（cat:<key>）／
  // リンク行（row:<uid>）。行がリンクを持てばリンク先ノードに依存し、シート合計は
  // 自シート内の ITEM 行に依存し、カテゴリ小計はメンバー ITEM 行に依存する。
  const VISITING = 1, DONE = 2;
  const state = new Map();      // nodeId → VISITING|DONE
  const valueCache = new Map(); // nodeId → number
  const cycleUids = new Set();  // 循環に巻き込まれた行の _uid

  const itemByUid = new Map(items.map((r) => [r._uid, r]));

  // リンク②の参照先カテゴリキー（存在すれば）
  const link2KeyOf = (row) =>
    row.linked_category_item_id != null
      ? catKeyByAnyRef.get(String(row.linked_category_item_id)) || null
      : null;

  // リンク①の参照先シートid（存在し、かつ実在シートなら）
  const link1SheetOf = (row) =>
    row.linked_sheet_id != null && sheetOrder.has(row.linked_sheet_id)
      ? row.linked_sheet_id
      : null;

  // 行の実効金額を解決して返す（リンク解決の副作用で eff を更新）。
  const resolveRow = (row) => {
    const e = eff.get(row._uid);
    const l2 = link2KeyOf(row);
    const l1 = link1SheetOf(row);

    if (l2) {
      // ② カテゴリ小計 → 数量1.0式・単価・名称・金額に反映
      const sub = resolveNode(`cat:${l2}`, row._uid);
      const cat = catItemsMap.get(l2)?.cat;
      e.quantity = 1;
      e.unit = '式';
      e.unit_price = sub;
      e.amount = sub;
      if (cat) e.name = cat.name || e.name;
      return sub;
    }
    if (l1) {
      // ① 別シート合計 → 単価に反映。金額 = 数量 × 単価（数量未入力は1扱い）。
      const sheetTotal = resolveNode(`sheet:${l1}`, row._uid);
      const qty = (row.quantity == null || row.quantity === '') ? 1 : toNum(row.quantity);
      e.unit_price = sheetTotal;
      e.amount = qty * sheetTotal;
      // 摘要に「明細書No.n」を自動表示（n = リンク先シートの1基底index）
      e.note = `明細書No.${sheetOrder.get(l1) + 1}`;
      return e.amount;
    }
    // 非リンク行: 金額は「明示値があればそれ、無ければ数量×単価」。
    if (row.amount !== '' && row.amount != null) {
      e.amount = toNum(row.amount);
    } else {
      e.amount = toNum(row.quantity) * toNum(row.unit_price);
    }
    return e.amount;
  };

  // ノード解決（メモ化＋循環検出）。originUid は循環時に巻き込み行として記録する起点。
  function resolveNode(nodeId, originUid) {
    const st = state.get(nodeId);
    if (st === DONE) return valueCache.get(nodeId);
    if (st === VISITING) {
      // 循環検出: このノードに関わる行を無効化対象に加え、0 を返して打ち切る
      if (originUid != null) cycleUids.add(originUid);
      return 0;
    }
    state.set(nodeId, VISITING);
    let value = 0;

    if (nodeId.startsWith('sheet:')) {
      const sid = nodeId.slice('sheet:'.length);
      // シート合計 = 当該シートの ITEM 行（空行除く）の実効金額の総和（FIXEDは除く）
      for (const row of items) {
        if (row.sheet_id !== sid) continue;
        if (row.item_type !== ITEM_TYPE.ITEM) continue;
        if (isBlankRow(row)) continue;
        value += resolveRow(row);
      }
    } else if (nodeId.startsWith('cat:')) {
      const key = nodeId.slice('cat:'.length);
      const entry = catItemsMap.get(key);
      if (entry) {
        for (const uid of entry.memberUids) {
          const row = itemByUid.get(uid);
          if (row) value += resolveRow(row);
        }
      }
    }

    state.set(nodeId, DONE);
    valueCache.set(nodeId, value);
    return value;
  }

  // --- 全シート合計を解決（これで連鎖するリンク行も芋づる式に解決される） ---
  const sheetTotals = new Map();
  for (const s of sheets || []) {
    sheetTotals.set(s.id, resolveNode(`sheet:${s.id}`, null));
  }

  // --- カテゴリ小計を（未解決分も含め）確定 ---
  const catTotals = new Map(); // 参照キー（id/tempId/uid 文字列）→ 小計
  for (const [key, { cat }] of catItemsMap) {
    const sub = resolveNode(`cat:${key}`, null);
    if (cat.id != null) catTotals.set(String(cat.id), sub);
    if (cat._tempId != null) catTotals.set(String(cat._tempId), sub);
    if (cat._uid != null) catTotals.set(String(cat._uid), sub);
  }

  // --- resolvedItems を構築（eff を元行にマージ） ---
  const resolvedItems = items.map((row) => {
    const e = eff.get(row._uid);
    return {
      ...row,
      unit_price: e.unit_price,
      quantity: e.quantity,
      amount: e.amount,
      name: e.name,
      note: e.note,
      unit: e.unit,
    };
  });

  return { resolvedItems, sheetTotals, catTotals, cycleUids };
};

// ============================================================
// 循環参照の到達可能性チェック（リンク作成時のガード）
// ============================================================
// 「行 row に link先 target を張ると循環するか」を、target 側から row の属する
// ノードへ到達できるかで判定する。リンク作成 UI がこれを使い、循環になるリンクを
// 事前に拒否する（design.md §5: クライアント側で到達可能性検査）。
//
// kind: 'sheet' なら targetRef = シートid、'category' なら targetRef = カテゴリの
// id/_tempId/_uid いずれか。row は単価をリンクで受ける側の明細行。
export const wouldCreateCycle = (sheets, items, row, kind, targetRef) => {
  const sheetOrder = new Map((sheets || []).map((s, i) => [s.id, i]));

  // カテゴリ参照 → 所属シートid、およびメンバー行の解決に必要な逆引きを組む
  const catKeyOf = (catItem) =>
    catItem.id != null ? `id:${catItem.id}` : `tmp:${catItem._tempId || catItem._uid}`;
  const catByAnyRef = new Map();  // 参照文字列 → { key, sheetId, memberUids:[] }
  const itemCatKey = new Map();   // row._uid → カテゴリキー
  {
    const perSheetCurrentCat = new Map();
    const catInfo = new Map();
    for (const it of items) {
      if (it.item_type === ITEM_TYPE.CATEGORY) {
        const key = catKeyOf(it);
        perSheetCurrentCat.set(it.sheet_id, key);
        if (!catInfo.has(key)) catInfo.set(key, { key, sheetId: it.sheet_id, memberUids: [] });
      } else if (it.item_type === ITEM_TYPE.ITEM) {
        const key = perSheetCurrentCat.get(it.sheet_id);
        if (key) { itemCatKey.set(it._uid, key); catInfo.get(key)?.memberUids.push(it._uid); }
      }
    }
    for (const info of catInfo.values()) {
      const cat = items.find(
        (x) => x.item_type === ITEM_TYPE.CATEGORY && catKeyOf(x) === info.key
      );
      if (!cat) continue;
      if (cat.id != null) catByAnyRef.set(String(cat.id), info);
      if (cat._tempId != null) catByAnyRef.set(String(cat._tempId), info);
      if (cat._uid != null) catByAnyRef.set(String(cat._uid), info);
    }
  }
  const itemByUid = new Map(items.map((r) => [r._uid, r]));

  // row が寄与する「起点ノード」: row の所属カテゴリ（あれば）と所属シート。
  // これらが target から到達可能なら、target→row→起点… で循環する。
  const originNodes = new Set();
  originNodes.add(`sheet:${row.sheet_id}`);
  const rowCatKey = itemCatKey.get(row._uid);
  if (rowCatKey) originNodes.add(`cat:${rowCatKey}`);

  // target ノードから依存グラフを辿り、origin に当たるかを DFS で探索する。
  const startNode = kind === 'sheet' ? `sheet:${targetRef}` : (() => {
    const info = catByAnyRef.get(String(targetRef));
    return info ? `cat:${info.key}` : null;
  })();
  if (!startNode) return false;

  const seen = new Set();
  const link1SheetOf = (r) =>
    r.linked_sheet_id != null && sheetOrder.has(r.linked_sheet_id) ? r.linked_sheet_id : null;
  const link2KeyOf = (r) => {
    if (r.linked_category_item_id == null) return null;
    const info = catByAnyRef.get(String(r.linked_category_item_id));
    return info ? info.key : null;
  };

  const rowDeps = (r) => {
    // 提案中のリンクも織り込む: row 自身が target を指す前提で探索する
    const deps = [];
    if (r._uid === row._uid) {
      if (kind === 'sheet') deps.push(`sheet:${targetRef}`);
      else {
        const info = catByAnyRef.get(String(targetRef));
        if (info) deps.push(`cat:${info.key}`);
      }
      return deps; // リンク行は他の値に依存しない（単価がリンクで決まる）
    }
    const l1 = link1SheetOf(r);
    if (l1) { deps.push(`sheet:${l1}`); return deps; }
    const l2 = link2KeyOf(r);
    if (l2) { deps.push(`cat:${l2}`); return deps; }
    return deps;
  };

  const memberRows = (nodeId) => {
    if (nodeId.startsWith('sheet:')) {
      const sid = nodeId.slice('sheet:'.length);
      return items.filter((r) => r.sheet_id === sid && r.item_type === ITEM_TYPE.ITEM);
    }
    const key = nodeId.slice('cat:'.length);
    const info = [...catByAnyRef.values()].find((v) => v.key === key);
    return info ? info.memberUids.map((u) => itemByUid.get(u)).filter(Boolean) : [];
  };

  const dfs = (nodeId) => {
    if (originNodes.has(nodeId)) return true;
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    for (const r of memberRows(nodeId)) {
      for (const dep of rowDeps(r)) {
        if (dfs(dep)) return true;
      }
    }
    return false;
  };

  return dfs(startNode);
};
