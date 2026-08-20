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
  const [manufacturersRes, rolesRes, axesRes, tagsRes, standardsRes, abbreviationsRes] = await Promise.all([
    supabase.from('paint_manufacturers').select('*').order('name', { ascending: true }),
    supabase.from('paint_process_roles').select('*').order('sort_order', { ascending: true }),
    supabase.from('paint_classification_axes').select('*').order('id', { ascending: true }),
    supabase.from('paint_classification_tags').select('*').order('sort_order', { ascending: true }),
    supabase.from('paint_standards').select('*').order('sort_order', { ascending: true }),
    supabase.from('paint_abbreviations').select('*').order('sort_order', { ascending: true }),
  ]);

  for (const res of [manufacturersRes, rolesRes, axesRes, tagsRes, standardsRes, abbreviationsRes]) {
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
    standards: standardsRes.data || [],
    abbreviations: abbreviationsRes.data || [],
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

/** 製品に紐づく規格認証（JIS/JASS）を全置換する */
const syncProductStandards = async (productId, standardIds) => {
  const { error: delError } = await supabase
    .from('paint_product_standards')
    .delete()
    .eq('product_id', productId);
  if (delError) throw delError;

  if (standardIds && standardIds.length > 0) {
    const rows = standardIds.map((standardId) => ({ product_id: productId, standard_id: standardId }));
    const { error: insError } = await supabase.from('paint_product_standards').insert(rows);
    if (insError) throw insError;
  }
};

/** 塗料製品の新規登録（タグ・規格認証を同時付与） */
export const createPaintProduct = async (product, tagIds = [], standardIds = []) => {
  const { data, error } = await supabase
    .from('paint_products')
    .insert([product])
    .select()
    .single();
  if (error) throw error;
  await syncProductTags(data.id, tagIds);
  await syncProductStandards(data.id, standardIds);
  return data;
};

/** 塗料製品の更新（タグ・規格認証は全置換） */
export const updatePaintProduct = async (id, product, tagIds = [], standardIds = []) => {
  const { data, error } = await supabase
    .from('paint_products')
    .update({ ...product, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await syncProductTags(id, tagIds);
  await syncProductStandards(id, standardIds);
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

/**
 * 塗料製品の一括新規登録（MDインポート用）
 * @param {Array<{product: Object, tagIds: number[]}>} items
 * @returns {Promise<Array>} 作成された製品データ（順序はitemsと対応）
 */
export const createPaintProductsBulk = async (items) => {
  const results = [];
  for (const item of items) {
    const data = await createPaintProduct(item.product, item.tagIds, item.standardIds || []);
    results.push(data);
  }
  return results;
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
      ),
      variants:coating_system_variants(*),
      abbreviations:coating_system_abbreviations(
        abbreviation:paint_abbreviations(id, code, name, sort_order)
      ),
      primary_product:paint_products!coating_systems_primary_product_id_fkey(id, name, product_code)
    `)
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (error) throw error;

  return (data || []).map((system) => ({
    ...system,
    steps: (system.steps || []).sort((a, b) => a.step_order - b.step_order),
  }));
};

export const createCoatingSystem = async ({ name, target_use, description, primary_product_id = null }) => {
  const { data, error } = await supabase
    .from('coating_systems')
    .insert([{ name, target_use, description, primary_product_id }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateCoatingSystem = async (id, { name, target_use, description, primary_product_id = null }) => {
  const { data, error } = await supabase
    .from('coating_systems')
    .update({ name, target_use, description, primary_product_id, updated_at: new Date().toISOString() })
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
 * @param {Array<{process_role_id: number, product_id: number, coat_count?: number}>} steps 工程順の配列（step_order はここで振り直す）
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
      coat_count: s.coat_count ?? 1,
    }));
    const { error: insError } = await supabase.from('coating_system_steps').insert(rows);
    if (insError) throw insError;
  }
};

// =============================
// 材工価格（仕様の価格分岐）
// =============================

/**
 * 価格分岐の全置換保存
 * 同一仕様でも「仕上げの種類 × 施工方法 × 目地 × 面積区分」で材工価格が変わるため、
 * 分岐は仕様に対する子レコードとしてまとめて差し替える。
 * @param {number} systemId
 * @param {Array<Object>} variants
 */
export const saveCoatingSystemVariants = async (systemId, variants) => {
  const { error: delError } = await supabase
    .from('coating_system_variants')
    .delete()
    .eq('coating_system_id', systemId);
  if (delError) throw delError;

  if (variants && variants.length > 0) {
    const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const textOrNull = (v) => (v === undefined || v === null || v === '' ? null : String(v).trim());
    const rows = variants.map((v) => ({
      coating_system_id: systemId,
      finish_type: textOrNull(v.finish_type),
      application_method: textOrNull(v.application_method),
      joint_type: textOrNull(v.joint_type),
      area_min: numOrNull(v.area_min),
      area_max: numOrNull(v.area_max),
      material_labor_price: numOrNull(v.material_labor_price),
      process_count: numOrNull(v.process_count),
      jis_a6909_compliant: !!v.jis_a6909_compliant,
    }));
    const { error: insError } = await supabase.from('coating_system_variants').insert(rows);
    if (insError) throw insError;
  }
};

// =============================
// 規格認証マスタ（JIS / JASS）
// =============================

export const createPaintStandard = async ({ standard_type, code, name, is_abolished = false, sort_order = 0 }) => {
  const { data, error } = await supabase
    .from('paint_standards')
    .insert([{ standard_type, code, name, is_abolished, sort_order }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updatePaintStandard = async (id, { standard_type, code, name, is_abolished, sort_order }) => {
  const { data, error } = await supabase
    .from('paint_standards')
    .update({ standard_type, code, name, is_abolished, sort_order, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deletePaintStandard = async (id) => {
  const { error } = await supabase.from('paint_standards').delete().eq('id', id);
  if (error) throw error;
};

// =============================
// 略号マスタ（SOP / VP / DP / EP 等）
// =============================

export const createPaintAbbreviation = async ({ code, name, description, sort_order = 0 }) => {
  const { data, error } = await supabase
    .from('paint_abbreviations')
    .insert([{ code, name, description, sort_order }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updatePaintAbbreviation = async (id, { code, name, description, sort_order }) => {
  const { data, error } = await supabase
    .from('paint_abbreviations')
    .update({ code, name, description, sort_order, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deletePaintAbbreviation = async (id) => {
  const { error } = await supabase.from('paint_abbreviations').delete().eq('id', id);
  if (error) throw error;
};

/**
 * 仕様に紐づく略号を全置換する（1仕様に複数の略号が付くことがある）
 * @param {number} systemId
 * @param {number[]} abbreviationIds
 */
export const saveCoatingSystemAbbreviations = async (systemId, abbreviationIds) => {
  const { error: delError } = await supabase
    .from('coating_system_abbreviations')
    .delete()
    .eq('coating_system_id', systemId);
  if (delError) throw delError;

  if (abbreviationIds && abbreviationIds.length > 0) {
    const rows = abbreviationIds.map((abbreviationId) => ({
      coating_system_id: systemId,
      abbreviation_id: abbreviationId,
    }));
    const { error: insError } = await supabase.from('coating_system_abbreviations').insert(rows);
    if (insError) throw insError;
  }
};

/**
 * ある製品に関係する塗装仕様を引く。
 * 「水性ケンエースグロス（EP-G）の下塗りは水性カチオンシーラー透明」のように、
 * 製品から関連材料を辿るために使う。代表製品・構成工程のどちらで使われていても拾う。
 * @param {number} productId
 */
export const fetchCoatingSystemsByProduct = async (productId) => {
  const { data: stepRows, error: stepError } = await supabase
    .from('coating_system_steps')
    .select('coating_system_id')
    .eq('product_id', productId);
  if (stepError) throw stepError;

  const { data: primaryRows, error: primaryError } = await supabase
    .from('coating_systems')
    .select('id')
    .eq('primary_product_id', productId)
    .is('deleted_at', null);
  if (primaryError) throw primaryError;

  const ids = [
    ...new Set([
      ...(stepRows || []).map((r) => r.coating_system_id),
      ...(primaryRows || []).map((r) => r.id),
    ]),
  ];
  if (ids.length === 0) return [];

  const systems = await fetchCoatingSystems();
  return systems.filter((s) => ids.includes(s.id));
};
