import { supabase } from '../../lib/supabase';

// =============================
// マスタ取得（選択肢用）
// =============================

/**
 * メーカー・工程区分・分類軸+タグを一括取得する
 * @returns {Promise<{manufacturers: Array, processRoles: Array, axes: Array}>}
 *   axes は各要素に tags 配列（sort_order順）を含む
 */
export const fetchPaintMasters = async () => {
  const [manufacturersRes, rolesRes, axesRes, tagsRes] = await Promise.all([
    supabase.from('paint_manufacturers').select('*').order('name', { ascending: true }),
    supabase.from('paint_process_roles').select('*').order('sort_order', { ascending: true }),
    supabase.from('paint_classification_axes').select('*').order('id', { ascending: true }),
    supabase.from('paint_classification_tags').select('*').order('sort_order', { ascending: true }),
  ]);

  for (const res of [manufacturersRes, rolesRes, axesRes, tagsRes]) {
    if (res.error) throw res.error;
  }

  const axes = (axesRes.data || []).map((axis) => ({
    ...axis,
    tags: (tagsRes.data || []).filter((t) => t.axis_id === axis.id),
  }));

  return {
    manufacturers: manufacturersRes.data || [],
    processRoles: rolesRes.data || [],
    axes,
  };
};

// =============================
// 塗料製品
// =============================

/**
 * 塗料製品の一覧・検索
 * @param {Object} filters
 * @param {number|null} filters.manufacturerId
 * @param {number|null} filters.processRoleId
 * @param {number[]} filters.tagIds - 指定タグを「すべて」持つ製品に絞る（AND条件）
 * @param {string} filters.search - 製品名・品番の部分一致
 */
export const fetchPaintProducts = async ({ manufacturerId = null, processRoleId = null, tagIds = [], search = '' } = {}) => {
  let query = supabase
    .from('paint_products')
    .select(`
      *,
      manufacturer:paint_manufacturers(id, name),
      process_role:paint_process_roles(id, name, sort_order),
      tags:paint_product_tags(tag_id)
    `)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (manufacturerId) query = query.eq('manufacturer_id', manufacturerId);
  if (processRoleId) query = query.eq('process_role_id', processRoleId);
  if (search && search.trim()) {
    const term = search.trim();
    query = query.or(`name.ilike.%${term}%,product_code.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const products = (data || []).map((p) => ({
    ...p,
    tagIds: (p.tags || []).map((t) => t.tag_id),
  }));

  if (tagIds.length === 0) return products;
  return products.filter((p) => tagIds.every((tagId) => p.tagIds.includes(tagId)));
};

/** 製品名の部分一致検索（仕入帳の紐付け候補用） */
export const searchPaintProductsByName = async (term, limit = 20) => {
  if (!term || !term.trim()) return [];
  const { data, error } = await supabase
    .from('paint_products')
    .select('id, name, product_code, manufacturer:paint_manufacturers(id, name)')
    .is('deleted_at', null)
    .or(`name.ilike.%${term.trim()}%,product_code.ilike.%${term.trim()}%`)
    .order('name', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
};

/** id 指定での製品取得（仕入帳の紐付け表示用） */
export const fetchPaintProductsByIds = async (ids) => {
  if (!ids || ids.length === 0) return [];
  const { data, error } = await supabase
    .from('paint_products')
    .select('id, name, product_code, manufacturer:paint_manufacturers(id, name)')
    .in('id', ids);
  if (error) throw error;
  return data || [];
};

const syncProductTags = async (productId, tagIds) => {
  const { error: delError } = await supabase
    .from('paint_product_tags')
    .delete()
    .eq('product_id', productId);
  if (delError) throw delError;

  if (tagIds && tagIds.length > 0) {
    const rows = tagIds.map((tagId) => ({ product_id: productId, tag_id: tagId }));
    const { error: insError } = await supabase.from('paint_product_tags').insert(rows);
    if (insError) throw insError;
  }
};

/** 塗料製品の新規登録（タグ同時付与） */
export const createPaintProduct = async (product, tagIds = []) => {
  const { data, error } = await supabase
    .from('paint_products')
    .insert([product])
    .select()
    .single();
  if (error) throw error;
  await syncProductTags(data.id, tagIds);
  return data;
};

/** 塗料製品の更新（タグは全置換） */
export const updatePaintProduct = async (id, product, tagIds = []) => {
  const { data, error } = await supabase
    .from('paint_products')
    .update({ ...product, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await syncProductTags(id, tagIds);
  return data;
};

/** 塗料製品の論理削除 */
export const deletePaintProduct = async (id) => {
  const { error } = await supabase
    .from('paint_products')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
};

// =============================
// メーカーマスタ
// =============================

export const createManufacturer = async (name) => {
  const { data, error } = await supabase
    .from('paint_manufacturers')
    .insert([{ name }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateManufacturer = async (id, name) => {
  const { error } = await supabase
    .from('paint_manufacturers')
    .update({ name })
    .eq('id', id);
  if (error) throw error;
};

// 物理削除（製品から参照中の場合は FK 制約エラーが throw される）
export const deleteManufacturer = async (id) => {
  const { error } = await supabase
    .from('paint_manufacturers')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

// =============================
// 工程区分マスタ
// =============================

export const createProcessRole = async ({ name, sort_order }) => {
  const { data, error } = await supabase
    .from('paint_process_roles')
    .insert([{ name, sort_order }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateProcessRole = async (id, { name, sort_order }) => {
  const { error } = await supabase
    .from('paint_process_roles')
    .update({ name, sort_order })
    .eq('id', id);
  if (error) throw error;
};

export const deleteProcessRole = async (id) => {
  const { error } = await supabase
    .from('paint_process_roles')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

// =============================
// 分類タグマスタ（軸は固定・タグ値のみCRUD）
// =============================

export const createClassificationTag = async ({ axis_id, value, sort_order }) => {
  const { data, error } = await supabase
    .from('paint_classification_tags')
    .insert([{ axis_id, value, sort_order }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateClassificationTag = async (id, { value, sort_order }) => {
  const { error } = await supabase
    .from('paint_classification_tags')
    .update({ value, sort_order })
    .eq('id', id);
  if (error) throw error;
};

export const deleteClassificationTag = async (id) => {
  const { error } = await supabase
    .from('paint_classification_tags')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

// =============================
// 塗装仕様（組み合わせレシピ）
// =============================

/** 塗装仕様一覧（構成行＋製品情報を含む） */
export const fetchCoatingSystems = async () => {
  const { data, error } = await supabase
    .from('coating_systems')
    .select(`
      *,
      steps:coating_system_steps(
        *,
        process_role:paint_process_roles(id, name, sort_order),
        product:paint_products(
          id, name, product_code, standard_usage_rate, usage_rate_unit, dilution_rate,
          manufacturer:paint_manufacturers(id, name),
          tags:paint_product_tags(tag_id)
        )
      )
    `)
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (error) throw error;

  return (data || []).map((system) => ({
    ...system,
    steps: (system.steps || []).sort((a, b) => a.step_order - b.step_order),
  }));
};

export const createCoatingSystem = async ({ name, target_use, description }) => {
  const { data, error } = await supabase
    .from('coating_systems')
    .insert([{ name, target_use, description }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateCoatingSystem = async (id, { name, target_use, description }) => {
  const { data, error } = await supabase
    .from('coating_systems')
    .update({ name, target_use, description, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** 塗装仕様の論理削除 */
export const deleteCoatingSystem = async (id) => {
  const { error } = await supabase
    .from('coating_systems')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
};

/**
 * 構成行の全置換保存
 * @param {number} systemId
 * @param {Array<{process_role_id: number, product_id: number}>} steps 工程順の配列（step_order はここで振り直す）
 */
export const saveCoatingSystemSteps = async (systemId, steps) => {
  const { error: delError } = await supabase
    .from('coating_system_steps')
    .delete()
    .eq('coating_system_id', systemId);
  if (delError) throw delError;

  if (steps && steps.length > 0) {
    const rows = steps.map((s, i) => ({
      coating_system_id: systemId,
      step_order: i + 1,
      process_role_id: s.process_role_id,
      product_id: s.product_id,
    }));
    const { error: insError } = await supabase.from('coating_system_steps').insert(rows);
    if (insError) throw insError;
  }
};
