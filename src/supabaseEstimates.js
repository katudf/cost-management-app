// src/supabaseEstimates.js
// 見積書機能のSupabase操作関数

import { supabase } from './lib/supabase';
import { ITEM_TYPE, ESTIMATE_STATUS, PROJECT_STATUS } from './utils/constants';
import { getStampSignedUrl } from './utils/stampStorage';

// ============================================================
// 見積書一覧取得
// ============================================================
export const fetchEstimates = async () => {
  const { data, error } = await supabase
    .from('estimates')
    .select(`
      *,
      customer:Customers(id, name),
      staff:office_staff!staff_id(id, name)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
};

// ============================================================
// 見積書1件取得（明細含む）
// ============================================================
export const fetchEstimateById = async (id) => {
  const { data, error } = await supabase
    .from('estimates')
    .select(`
      *,
      customer:Customers(id, name),
      staff:office_staff!staff_id(id, name),
      items:estimate_items(*)
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error) throw error;

  // 明細をsort_order順に並べ替え
  if (data?.items) {
    data.items.sort((a, b) => a.sort_order - b.sort_order);
  }
  return data;
};

// ============================================================
// 見積番号の次番号を取得（自動採番）
// ============================================================
export const getNextEstimateSeq = async (datePrefix) => {
  const { data, error } = await supabase
    .rpc('get_next_estimate_seq', { date_prefix: datePrefix });

  if (error) throw error;
  return data; // 例: '0004'
};

// ============================================================
// 見積書の新規作成
// ============================================================
export const createEstimate = async (estimateData) => {
  const { data, error } = await supabase
    .from('estimates')
    .insert([estimateData])
    .select()
    .single();

  if (error) throw error;
  return data;
};

// ============================================================
// 見積書の更新
// ============================================================
export const updateEstimate = async (id, estimateData) => {
  const { data, error } = await supabase
    .from('estimates')
    .update(estimateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

// ============================================================
// 見積の承認・差し戻し（SECURITY DEFINER RPC経由）
// status の pending → approved/returned 遷移と承認証跡（approved_by/approved_at）は
// DBトリガーで直接UPDATEが拒否されるため、必ずこのRPCを使うこと
// ============================================================
// 証跡カラムはDB側（now()）で記録されるため、実行後に再取得して返す。
// クライアント時刻をローカルstateに持つとDB値とズレ、後続UPDATEがトリガーに拒否されるため
const fetchApprovalTrail = async (id) => {
  const { data, error } = await supabase
    .from('estimates')
    .select('status, approved_by, approved_at, returned_reason')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
};

export const approveEstimate = async (id) => {
  const { error } = await supabase.rpc('approve_estimate', { p_estimate_id: id });
  if (error) throw error;
  return fetchApprovalTrail(id);
};

export const returnEstimate = async (id, reason) => {
  const { error } = await supabase.rpc('return_estimate', {
    p_estimate_id: id,
    p_reason: reason,
  });
  if (error) throw error;
  return fetchApprovalTrail(id);
};

// ============================================================
// 見積書の論理削除
// ============================================================
export const deleteEstimate = async (id) => {
  const { error } = await supabase
    .from('estimates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
};

// ============================================================
// 見積番号の重複チェック
// ============================================================
export const checkDuplicateNumber = async (estimateNumber, excludeId = null) => {
  // DBのユニーク制約は論理削除済みレコードにも適用されるため、
  // deleted_atフィルターなしで全レコードを対象にチェックする
  let query = supabase
    .from('estimates')
    .select('id')
    .eq('estimate_number', estimateNumber);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data && data.length > 0;
};

// ============================================================
// 空き枝番の探索（重複しない見積番号を見つける）
// ------------------------------------------------------------
// prefix（発行日8桁）・seq（連番4桁）が同じ枝番のうち、
// startBranch から始めて未使用の枝番を持つ見積番号を返す。
// ============================================================
export const findAvailableBranchNumber = async (prefix, seq, startBranch = 1) => {
  let branch = startBranch;
  let estimateNumber = `${prefix}-${seq}-${String(branch).padStart(3, '0')}`;
  while (await checkDuplicateNumber(estimateNumber)) {
    branch++;
    if (branch > 999) throw new Error('見積番号の採番に失敗しました（枝番上限）');
    estimateNumber = `${prefix}-${seq}-${String(branch).padStart(3, '0')}`;
  }
  return estimateNumber;
};

// ============================================================
// 見積書の複製（枝番+1、重複時は空き枝番まで繰り上げ）
// ============================================================
export const duplicateEstimate = async (id) => {
  // 元データ取得
  const original = await fetchEstimateById(id);

  // 枝番+1から開始し、重複があれば空きが見つかるまで繰り上げる
  const parts = original.estimate_number.split('-');
  const newNumber = await findAvailableBranchNumber(parts[0], parts[1], parseInt(parts[2]) + 1);

  // ヘッダー複製
  const { id: _id, created_at, updated_at, deleted_at, ...headerData } = original;
  const newEstimate = await createEstimate({
    ...headerData,
    estimate_number: newNumber,
    status: ESTIMATE_STATUS.DRAFT,
    issue_date: new Date().toISOString().split('T')[0],
    customer: undefined,
    creator: undefined,
    items: undefined,
  });

  // 明細複製
  if (original.items?.length > 0) {
    const newItems = original.items.map(({ id: _iid, created_at: _c, estimate_id: _e, ...item }) => ({
      ...item,
      estimate_id: newEstimate.id,
    }));
    const { error } = await supabase.from('estimate_items').insert(newItems);
    if (error) throw error;
  }

  return newEstimate;
};

// ============================================================
// 明細の一括保存（削除＋再挿入を単一トランザクションで実行）
// ============================================================
export const saveEstimateItems = async (estimateId, items) => {
  // save_estimate_items RPC が delete + insert を1トランザクションで実行するため、
  // 途中で失敗しても明細が全損しない（従来のクライアント側2段階処理を置き換え）。
  // sort_order はサーバー側で配列順に振り直されるため、渡す順序が保存順になる。
  const payloadItems = items.map((item) => {
    const { id: _id, created_at: _ca, estimate_id: _eid, sort_order: _so, ...rest } = item;
    return rest;
  });

  const { error } = await supabase.rpc('save_estimate_items', {
    p_estimate_id: estimateId,
    p_items: payloadItems,
  });

  if (error) throw error;
};

// ============================================================
// 承認済み見積を工事案件（Projects）へ連携
// ------------------------------------------------------------
// estimates.project_id で紐付け済みの案件があればそれを使い回す
// （工事名変更後の再承認でも重複作成されない）。
// 未連携の場合のみ status=見積 の案件を order 末尾に新規作成する。
// 失敗時は例外を投げる（呼び出し側で showToast 通知する想定）。
// 戻り値: 連携先となった Projects.id
// ============================================================
export const syncEstimateToProject = async ({ projectId, title, customerId }) => {
  if (projectId) {
    const { data: existing, error: selectError } = await supabase
      .from('Projects')
      .select('id')
      .eq('id', projectId)
      .limit(1);

    if (selectError) throw selectError;
    if (existing && existing.length > 0) return projectId; // 既に連携済み → 作成不要
  }

  const { data: maxOrder, error: orderError } = await supabase
    .from('Projects')
    .select('order')
    .order('order', { ascending: false })
    .limit(1);

  if (orderError) throw orderError;
  const nextOrder = (maxOrder?.[0]?.order || 0) + 1;

  const { data: inserted, error: insertError } = await supabase
    .from('Projects')
    .insert([{
      name: title,
      customerId,
      status: PROJECT_STATUS.ESTIMATE,
      order: nextOrder,
    }])
    .select('id')
    .single();

  if (insertError) throw insertError;
  return inserted.id;
};

// ============================================================
// 顧客一覧取得（フォームのプルダウン用）
// ============================================================
export const fetchCustomers = async () => {
  const { data, error } = await supabase
    .from('Customers')
    .select('id, name')
    .order('name');

  if (error) throw error;
  return data;
};

// ============================================================
// 顧客の新規登録
// ============================================================
export const createCustomer = async (name) => {
  const { data, error } = await supabase
    .from('Customers')
    .insert([{ name }])
    .select()
    .single();

  if (error) throw error;
  return data;
};

// ============================================================
// 作業員一覧取得（作成者選択用）
// ============================================================
export const fetchWorkers = async () => {
  const { data, error } = await supabase
    .from('Workers')
    .select('id, name, stamp_url')
    .is('resignation_date', null)
    .order('display_order');

  if (error) throw error;
  return data;
};

// ============================================================
// 金額計算ユーティリティ
// ============================================================
export const calcTotals = (items, taxRate = 0.1, netCalcSettings = {}) => {
  const itemRows = items.filter(i => i.item_type === ITEM_TYPE.ITEM);
  const fixedRows = items.filter(i => i.item_type === ITEM_TYPE.FIXED);

  const itemTotal = itemRows.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const fixedTotal = fixedRows.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  // NET金額（純工事費）の計算設定
  const { type = 'perc', perc = 95, manualAmount } = netCalcSettings;
  let net;
  const baseAmount = itemTotal + fixedTotal; // 純工事費＋法定福利・安全費をベースにする

  if (type === 'perc') {
    net = Math.floor(baseAmount * (Number(perc) / 100));
  } else if (type === 'manual') {
    net = Number(manualAmount) || 0;
  } else {
    // 互換性のため: 旧 auto の場合は 100% として計算
    net = baseAmount;
  }

  const subtotal = itemTotal + fixedTotal;      // 税抜合計
  const tax = Math.floor(subtotal * taxRate);   // 消費税（切り捨て）
  const total = subtotal + tax;                 // 税込合計

  return { net, fixedTotal, subtotal, tax, total };
};

// ============================================================
// 金額フォーマット
// ============================================================
export const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toLocaleString('ja-JP');
};

// ============================================================
// 担当者（関係者）の取得
// ============================================================
export const fetchOfficeStaff = async () => {
  const { data, error } = await supabase
    .from('office_staff')
    .select('*')
    .order('id', { ascending: true });

  if (error) throw error;
  return data;
};

// ============================================================
// システム設定の取得（id=1 固定行）
// ============================================================
export const fetchSystemSettings = async () => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('*')
    .eq('id', 1)
    .single();

  // PGRST116 = row not found → 空オブジェクトで返す
  if (error && error.code !== 'PGRST116') throw error;
  const settings = data || {};

  // stamps バケットは private のため、印影はPDF・プレビューから参照できる署名付きURLに変換して返す。
  // 変換失敗時（画像削除済み等）は null にして印影なしでPDF生成を続行する
  const [companyUrl, representativeUrl] = await Promise.all([
    getStampSignedUrl(settings.stamp_company_url).catch((e) => {
      console.error('社印の署名付きURL取得エラー:', e);
      return null;
    }),
    getStampSignedUrl(settings.stamp_representative_url).catch((e) => {
      console.error('代表印の署名付きURL取得エラー:', e);
      return null;
    }),
  ]);

  return {
    ...settings,
    stamp_company_url: companyUrl,
    stamp_representative_url: representativeUrl,
  };
};
