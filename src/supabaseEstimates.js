// src/supabaseEstimates.js
// 見積書機能のSupabase操作関数

import { supabase } from './lib/supabase';

// ============================================================
// 見積書一覧取得
// ============================================================
export const fetchEstimates = async () => {
  const { data, error } = await supabase
    .from('estimates')
    .select(`
      *,
      customer:Customers(id, name),
      staff:office_staff(id, name)
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
      staff:office_staff(id, name),
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
  let query = supabase
    .from('estimates')
    .select('id')
    .eq('estimate_number', estimateNumber)
    .is('deleted_at', null);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data && data.length > 0;
};

// ============================================================
// 見積書の複製（枝番+1）
// ============================================================
export const duplicateEstimate = async (id) => {
  // 元データ取得
  const original = await fetchEstimateById(id);

  // 枝番+1の新しい見積番号を生成
  const parts = original.estimate_number.split('-');
  const newBranch = String(parseInt(parts[2]) + 1).padStart(3, '0');
  const newNumber = `${parts[0]}-${parts[1]}-${newBranch}`;

  // ヘッダー複製
  const { id: _id, created_at, updated_at, deleted_at, ...headerData } = original;
  const newEstimate = await createEstimate({
    ...headerData,
    estimate_number: newNumber,
    status: 'draft',
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
// 明細の一括保存（upsert）
// ============================================================
export const saveEstimateItems = async (estimateId, items) => {
  // 既存明細を全削除してから再挿入（シンプルな実装）
  const { error: deleteError } = await supabase
    .from('estimate_items')
    .delete()
    .eq('estimate_id', estimateId);

  if (deleteError) throw deleteError;

  if (items.length === 0) return;

  const insertData = items.map((item, index) => ({
    ...item,
    estimate_id: estimateId,
    sort_order: index,
  }));

  const { error } = await supabase
    .from('estimate_items')
    .insert(insertData);

  if (error) throw error;
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
  const itemRows = items.filter(i => i.item_type === 'item');
  const fixedRows = items.filter(i => i.item_type === 'fixed');

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
