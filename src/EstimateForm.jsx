// src/EstimateForm.jsx
// 見積書入力画面（ヘッダー + 明細）

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Save, FileText, Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Lock, Unlock } from 'lucide-react';
import {
  fetchEstimateById,
  createEstimate,
  updateEstimate,
  saveEstimateItems,
  fetchCustomers,
  fetchWorkers,
  getNextEstimateSeq,
  calcTotals,
  formatCurrency,
  checkDuplicateNumber,
  fetchOfficeStaff,
} from './supabaseEstimates';

// 今日の日付を YYMMDD 形式で返す
const todayPrefix = () => {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
};

// 日付をinput[type=date]用のyyyy-mm-dd形式に変換
const toInputDate = (val) => {
  if (!val) return '';
  return String(val).slice(0, 10);
};

// 空の明細行テンプレート
const newItemRow = (estimateId, parentId, sortOrder) => ({
  estimate_id: estimateId,
  parent_id: parentId,
  sort_order: sortOrder,
  item_type: 'item',
  category_symbol: null,
  name: '',
  spec: '',
  quantity: '',
  unit: '',
  unit_price: '',
  amount: '',
  note: '',
});

const newCategoryRow = (sortOrder) => ({
  item_type: 'category',
  category_symbol: '',
  name: '',
  spec: null,
  quantity: null,
  unit: null,
  unit_price: null,
  amount: null,
  note: null,
  sort_order: sortOrder,
  _tempId: `cat_${Date.now()}_${Math.random()}`,
});

const fixedRows = [
  { item_type: 'fixed', name: '法定福利費', quantity: 1, unit: '式', amount: '', note: '' },
  { item_type: 'fixed', name: '安全費',     quantity: 1, unit: '式', amount: '', note: '' },
];

const UNIT_SUGGESTIONS = ['m²', 'm', 'm³', '本', '式', 'ヶ所', '個', 't', '枚', '組'];
const MAX_ROWS = 300;

// ============================================================
// メインコンポーネント
// ============================================================
const EstimateForm = ({ estimateId, onBack, onSaved }) => {
  const isNew = !estimateId;

  // ヘッダー state
  const [header, setHeader] = useState({
    estimate_number_date: todayPrefix(),
    estimate_number_seq: '0001',
    estimate_number_branch: '001',
    customer_id: '',
    customer_honorific: '御中',
    title: '',
    site_location: '',
    work_period: '',
    issue_date: toInputDate(new Date()),
    valid_until: '',
    payment_terms: '従来通り',
    notes: '',
    tax_rate: 0.10,
    status: 'draft',
    show_fixed_fees: true,
    show_net: true,
    show_subtotals: false,
    stamp_header: 'company',
    show_approver: false,
    staff_id: '',
    net_calc_type: 'perc', // perc, manual ("auto"は廃止)
    net_perc: 95,
    net_amount: '',
  });

  // 明細 state（フラットリスト）
  const [items, setItems] = useState([]);

  // マスターデータ
  const [customers, setCustomers] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [officeStaff, setOfficeStaff] = useState([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [numberError, setNumberError] = useState('');

  // 見積番号を文字列に結合
  const estimateNumber = [
    header.estimate_number_date,
    header.estimate_number_seq,
    header.estimate_number_branch,
  ].join('-');

  // ============================================================
  // 初期データ読み込み
  // ============================================================
  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const [custData, workerData, staffData] = await Promise.all([
          fetchCustomers(),
          fetchWorkers(),
          fetchOfficeStaff(),
        ]);
        setCustomers(custData);
        setWorkers(workerData);
        setOfficeStaff(staffData);

        if (isNew) {
          // 新規: 見積番号の自動採番
          const prefix = todayPrefix();
          const seq = await getNextEstimateSeq(prefix);
          setHeader(h => ({
            ...h,
            estimate_number_date: prefix,
            estimate_number_seq: seq,
            customer_honorific: '御中',
          }));
          // デフォルト明細（工種1つ + 固定費）
          setItems([
            { ...newCategoryRow(0), category_symbol: 'A', name: '' },
            { ...newItemRow(null, null, 1) },
            ...fixedRows.map((r, i) => ({ ...r, sort_order: 100 + i })),
          ]);
        } else {
          // 編集: 既存データ読み込み
          const est = await fetchEstimateById(estimateId);
          const parts = est.estimate_number.split('-');
          setHeader({
            estimate_number_date: parts[0] || '',
            estimate_number_seq:  parts[1] || '',
            estimate_number_branch: parts[2] || '001',
            customer_id:    String(est.customer_id || ''),
            customer_honorific: est.customer_honorific || '御中',
            title:          est.title || '',
            site_location:  est.site_location || '',
            work_period:    est.work_period || '',
            issue_date:     toInputDate(est.issue_date),
            valid_until:    toInputDate(est.valid_until),
            payment_terms:  est.payment_terms || '従来通り',
            notes:          est.notes || '',
            tax_rate:       est.tax_rate || 0.10,
            status:         est.status || 'draft',
            show_fixed_fees: est.show_fixed_fees ?? true,
            show_net:        est.show_net ?? true,
            show_subtotals:  est.show_subtotals ?? false,
            stamp_header:    est.stamp_header || 'company',
            show_approver:   est.show_approver ?? false,
            staff_id:        String(est.staff_id || ''),
            net_calc_type:   (est.net_calc_type === 'auto' || !est.net_calc_type) ? 'perc' : est.net_calc_type,
            net_perc:        est.net_perc ?? 95,
            net_amount:      est.net_amount ?? '',
          });
          setItems(est.items || []);
        }
      } catch (e) {
        setError('データの読み込みに失敗しました: ' + e.message);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [estimateId, isNew]);

  // ============================================================
  // ヘッダー入力ハンドラ
  // ============================================================
  const handleHeaderChange = useCallback((field, value) => {
    setHeader(h => ({ ...h, [field]: value }));
  }, []);

  // ============================================================
  // 明細操作
  // ============================================================
  // 工種行追加
  const addCategory = () => {
    const categories = items.filter(i => i.item_type === 'category');
    const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nextSymbol = symbols[categories.length] || '';
    const newRow = {
      ...newCategoryRow(items.length),
      category_symbol: nextSymbol,
    };
    setItems(prev => [...prev.filter(i => i.item_type !== 'fixed'), newRow,
      newItemRow(null, null, items.length + 1),
      ...prev.filter(i => i.item_type === 'fixed'),
    ]);
  };

  // 細別行追加（最後のcategory配下に）
  const addItem = (afterIndex) => {
    const newRow = newItemRow(null, null, afterIndex + 1);
    setItems(prev => {
      const next = [...prev];
      next.splice(afterIndex + 1, 0, newRow);
      return next.map((r, i) => ({ ...r, sort_order: i }));
    });
  };

  // 行削除
  const removeRow = (index) => {
    setItems(prev => {
      const target = prev[index];
      if (target.item_type === 'category') {
        // 工種行削除：配下の細別も削除（次のcategoryまで）
        let end = index + 1;
        while (end < prev.length && prev[end].item_type === 'item') end++;
        return prev.filter((_, i) => i < index || i >= end);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // 明細フィールド更新
  const updateItem = useCallback((index, field, value) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // 数量・単価が変わったら金額を自動計算
      if (field === 'quantity' || field === 'unit_price') {
        const q = field === 'quantity' ? value : next[index].quantity;
        const p = field === 'unit_price' ? value : next[index].unit_price;
        if (q !== '' && p !== '') {
          next[index].amount = String(Number(q) * Number(p));
        }
      }
      return next;
    });
  }, []);

  // ============================================================
  // 合計計算
  // ============================================================
  const visibleItems = items.filter(i =>
    i.item_type === 'item' ||
    (i.item_type === 'fixed' && header.show_fixed_fees)
  );
  const totals = calcTotals(visibleItems, Number(header.tax_rate), {
    type: header.net_calc_type,
    perc: header.net_perc,
    manualAmount: header.net_amount
  });

  // ============================================================
  // 編集ロック判定
  // ============================================================
  const isLocked = !isNew && header.status !== 'draft';

  // 下書きに戻す
  const handleUnlock = async () => {
    try {
      setSaving(true);
      await updateEstimate(estimateId, { status: 'draft' });
      setHeader(h => ({ ...h, status: 'draft' }));
    } catch (e) {
      setError('ステータスの変更に失敗しました: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // 工種ごとの小計計算（UI表示用）
  // ============================================================
  const categorySubtotals = useMemo(() => {
    const result = {};
    let currentCatKey = null;
    items.forEach(item => {
      if (item.item_type === 'category') {
        currentCatKey = item.id || item._tempId || item.category_symbol;
        result[currentCatKey] = 0;
      } else if (item.item_type === 'item' && currentCatKey) {
        result[currentCatKey] += Number(item.amount) || 0;
      }
    });
    return result;
  }, [items]);

  // ============================================================
  // 保存処理
  // ============================================================
  const handleSave = async () => {
    // 編集ロックチェック
    if (isLocked) { setError('提出済み以降の見積書は編集できません。「下書きに戻す」を実行してください。'); return; }

    // バリデーション
    if (!header.customer_id) { setError('顧客を選択してください'); return; }
    if (!header.title.trim()) { setError('工事名を入力してください'); return; }
    if (!estimateNumber.match(/^\d{6}-\d{4}-\d{3}$/)) {
      setNumberError('形式: YYMMDD-NNNN-NNN');
      return;
    }

    // 工種・細別バリデーション
    const categories = items.filter(i => i.item_type === 'category');
    if (categories.length === 0) {
      setError('工種を最低1件追加してください。');
      return;
    }
    let catIdx = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].item_type === 'category') {
        const catName = items[i].name || items[i].category_symbol || `工種${catIdx + 1}`;
        // この工種配下に名称入力済みの細別があるか
        let hasItem = false;
        for (let j = i + 1; j < items.length; j++) {
          if (items[j].item_type === 'category') break;
          if (items[j].item_type === 'item' && items[j].name?.trim()) { hasItem = true; break; }
        }
        if (!hasItem) {
          setError(`「${catName}」に細別を最低1件追加してください。`);
          return;
        }
        catIdx++;
      }
    }

    // 行数上限チェック
    if (items.length > MAX_ROWS) {
      setError(`明細行数が上限（${MAX_ROWS}行）を超えています。現在 ${items.length} 行です。`);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setNumberError('');

      // 見積番号の重複チェック
      const isDuplicate = await checkDuplicateNumber(estimateNumber, estimateId || null);
      if (isDuplicate) {
        setNumberError(`見積番号「${estimateNumber}」は既に使用されています。`);
        setSaving(false);
        return;
      }

      // 合計行の自動生成（show_subtotals=ON 時）
      let finalItems = [...items];
      // まず既存のsubtotal行を除去
      finalItems = finalItems.filter(i => i.item_type !== 'subtotal');
      if (header.show_subtotals) {
        const withSubtotals = [];
        let currentCatKey = null;
        let catAmount = 0;
        finalItems.forEach((item, idx) => {
          if (item.item_type === 'category') {
            // 前の工種の合計行を挿入
            if (currentCatKey !== null) {
              withSubtotals.push({
                item_type: 'subtotal',
                name: '合　計',
                amount: catAmount,
                sort_order: withSubtotals.length,
              });
            }
            currentCatKey = item.id || item._tempId || idx;
            catAmount = 0;
          } else if (item.item_type === 'item') {
            catAmount += Number(item.amount) || 0;
          }
          withSubtotals.push(item);
        });
        // 最後の工種の合計行
        if (currentCatKey !== null) {
          withSubtotals.push({
            item_type: 'subtotal',
            name: '合　計',
            amount: catAmount,
            sort_order: withSubtotals.length,
          });
        }
        finalItems = withSubtotals;
      }

      // 税込合計を計算
      const savingVisibleItems = finalItems.filter(i =>
        i.item_type === 'item' ||
        (i.item_type === 'fixed' && header.show_fixed_fees)
      );
      const savingTotals = calcTotals(savingVisibleItems, Number(header.tax_rate), {
        type: header.net_calc_type,
        perc: header.net_perc,
        manualAmount: header.net_amount
      });

      const payload = {
        estimate_number: estimateNumber,
        customer_id:    Number(header.customer_id),
        customer_honorific: header.customer_honorific,
        title:          header.title,
        site_location:  header.site_location || null,
        work_period:    header.work_period || null,
        issue_date:     header.issue_date || null,
        valid_until:    header.valid_until || null,
        payment_terms:  header.payment_terms,
        notes:          header.notes || null,
        tax_rate:       Number(header.tax_rate),
        status:         header.status,
        show_fixed_fees: header.show_fixed_fees,
        show_net:        header.show_net,
        show_subtotals:  header.show_subtotals,
        stamp_header:    header.stamp_header,
        show_approver:   header.show_approver,
        staff_id:        header.staff_id ? Number(header.staff_id) : null,
        net_calc_type:   header.net_calc_type,
        net_perc:        Number(header.net_perc),
        net_amount:      header.net_amount !== '' ? Number(header.net_amount) : null,
        total_with_tax:  savingTotals.total,
      };

      let savedId = estimateId;
      if (isNew) {
        const created = await createEstimate(payload);
        savedId = created.id;
      } else {
        await updateEstimate(estimateId, payload);
      }

      // 明細保存
      const saveableItems = finalItems
        .filter(i => i.name?.trim())
        .map(({ _tempId, ...i }) => ({
          ...i,
          estimate_id: savedId,
          quantity:   i.quantity !== '' && i.quantity != null ? Number(i.quantity) : null,
          unit_price: i.unit_price !== '' && i.unit_price != null ? Number(i.unit_price) : null,
          amount:     i.amount !== '' && i.amount != null ? Number(i.amount) : null,
        }));
      await saveEstimateItems(savedId, saveableItems);

      onSaved?.();
    } catch (e) {
      setError('保存に失敗しました: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // レンダリング
  // ============================================================
  if (loading) {
    return (
      <div className="p-6 text-center text-slate-400">読み込み中...</div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">

      {/* ページヘッダー */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText size={22} className="text-blue-600" />
            {isNew ? '見積書 新規作成' : '見積書 編集'}
          </h2>
          {isLocked && (
            <span className="flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
              <Lock size={12} /> 編集ロック中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLocked && (
            <button
              onClick={handleUnlock}
              disabled={saving}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white px-4 py-2 rounded-lg font-bold transition text-sm"
            >
              <Unlock size={16} />
              下書きに戻す
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || isLocked}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-5 py-2 rounded-lg font-bold transition"
          >
            <Save size={18} />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 編集ロックバナー */}
      {isLocked && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-2">
          <Lock size={16} />
          この見積書は「{header.status === 'submitted' ? '提出済み' : header.status === 'accepted' ? '受注' : '失注'}」のため編集できません。編集するには「下書きに戻す」を実行してください。
        </div>
      )}

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ===== 左・メインカラム ===== */}
        <div className="lg:col-span-2 space-y-5">

          {/* 見積番号 */}
          <Section title="見積番号">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                maxLength={6}
                placeholder="YYMMDD"
                value={header.estimate_number_date}
                onChange={e => handleHeaderChange('estimate_number_date', e.target.value)}
                className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-400 font-bold">-</span>
              <input
                type="text"
                maxLength={4}
                placeholder="0001"
                value={header.estimate_number_seq}
                onChange={e => handleHeaderChange('estimate_number_seq', e.target.value)}
                className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-400 font-bold">-</span>
              <input
                type="text"
                maxLength={3}
                placeholder="001"
                value={header.estimate_number_branch}
                onChange={e => handleHeaderChange('estimate_number_branch', e.target.value)}
                className="w-16 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-500 text-sm font-mono ml-1">
                → {estimateNumber}
              </span>
            </div>
            {numberError && (
              <p className="text-red-500 text-xs mt-1">{numberError}</p>
            )}
          </Section>

          {/* 工事情報 */}
          <Section title="工事情報">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

              <div className="md:col-span-2">
                <Label required>工事名</Label>
                <input
                  type="text"
                  value={header.title}
                  onChange={e => handleHeaderChange('title', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例: 水沢中学校校舎等改築建築工事"
                />
              </div>

              <div>
                <Label required>顧客</Label>
                <div className="flex gap-2">
                  <select
                    value={header.customer_id}
                    onChange={e => handleHeaderChange('customer_id', e.target.value)}
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  >
                    <option value="">-- 選択してください --</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <select
                    value={header.customer_honorific}
                    onChange={e => handleHeaderChange('customer_honorific', e.target.value)}
                    className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  >
                    <option value="御中">御中</option>
                    <option value="様">様</option>
                    <option value="殿">殿</option>
                    <option value="なし">なし</option>
                  </select>
                </div>
              </div>

              <div>
                <Label>工事場所</Label>
                <input
                  type="text"
                  value={header.site_location}
                  onChange={e => handleHeaderChange('site_location', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例: 取り決めの通り"
                />
              </div>

              <div>
                <Label>工期</Label>
                <input
                  type="text"
                  value={header.work_period}
                  onChange={e => handleHeaderChange('work_period', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="例: 取り決めの通り / 令和7年3月末"
                />
              </div>

              <div>
                <Label>見積日</Label>
                <input
                  type="date"
                  value={header.issue_date}
                  onChange={e => handleHeaderChange('issue_date', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <Label>有効期限</Label>
                <input
                  type="date"
                  value={header.valid_until}
                  onChange={e => handleHeaderChange('valid_until', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <Label>支払条件</Label>
                <input
                  type="text"
                  value={header.payment_terms}
                  onChange={e => handleHeaderChange('payment_terms', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <Label>担当者</Label>
                <select
                  value={header.staff_id}
                  onChange={e => handleHeaderChange('staff_id', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="">-- 選択 --</option>
                  {officeStaff.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <Label>備考</Label>
                <textarea
                  value={header.notes}
                  onChange={e => handleHeaderChange('notes', e.target.value)}
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  placeholder="備考・特記事項"
                />
              </div>
            </div>
          </Section>

          {/* 明細 */}
          <Section title={`見積内訳明細（${items.length}行）`}>
            <ItemTable
              items={items}
              showFixedFees={header.show_fixed_fees}
              showSubtotals={header.show_subtotals}
              categorySubtotals={categorySubtotals}
              onUpdateItem={updateItem}
              onAddCategory={addCategory}
              onAddItem={addItem}
              onRemoveRow={removeRow}
              disabled={isLocked}
            />
            {items.length > MAX_ROWS && (
              <p className="text-red-500 text-xs mt-2 font-bold">⚠ 行数が上限（{MAX_ROWS}行）を超えています</p>
            )}
          </Section>

        </div>

        {/* ===== 右サイドバー ===== */}
        <div className="space-y-4">

          {/* 合計パネル */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sticky top-4">
            <h3 className="font-bold text-slate-700 mb-3 text-sm">金額集計</h3>
            <div className="space-y-1.5 text-sm">
              <TotalRow label="工事費" value={totals.subtotal} bold />
              <TotalRow label={`消費税（${Math.round(Number(header.tax_rate) * 100)}%）`} value={totals.tax} />
              <div className="border-t border-slate-300 my-2" />
              <TotalRow label="税込合計" value={totals.total} bold large />
              {header.show_net && (
                <>
                  <div className="border-t border-slate-300 my-2" />
                  <TotalRow label="NET金額" value={totals.net} bold />
                </>
              )}
            </div>

            {/* NET計算詳細設定 */}
            {header.show_net && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-wider">NET計算設定</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="net_type"
                        checked={header.net_calc_type === 'perc' || header.net_calc_type === 'auto'}
                        onChange={() => handleHeaderChange('net_calc_type', 'perc')}
                        className="text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                      />
                      <span className="text-xs text-slate-600">％指定</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="net_type"
                        checked={header.net_calc_type === 'manual'}
                        onChange={() => handleHeaderChange('net_calc_type', 'manual')}
                        className="text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                      />
                      <span className="text-xs text-slate-600">手入力</span>
                    </label>
                  </div>

                  {header.net_calc_type !== 'manual' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={header.net_perc}
                        onChange={e => handleHeaderChange('net_perc', e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-400"
                        placeholder="パーセント"
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </div>
                  )}

                  {header.net_calc_type === 'manual' && (
                    <div className="relative">
                      <span className="absolute left-3 top-1.5 text-slate-400 text-xs">¥</span>
                      <input
                        type="number"
                        value={header.net_amount}
                        onChange={e => handleHeaderChange('net_amount', e.target.value)}
                        className="w-full border border-slate-300 rounded-lg pl-6 pr-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-400"
                        placeholder="金額を入力"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ステータス */}
          <Section title="ステータス">
            <select
              value={header.status}
              onChange={e => handleHeaderChange('status', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              <option value="draft">下書き</option>
              <option value="submitted">提出済み</option>
              <option value="accepted">受注</option>
              <option value="rejected">失注</option>
            </select>
          </Section>

          {/* 表示設定 */}
          <Section title="PDF表示設定">
            <div className="space-y-2 text-sm">
              {[
                { key: 'show_fixed_fees', label: '法定福利費・安全費を表示' },
                { key: 'show_net',        label: 'NET金額を表示' },
                { key: 'show_subtotals',  label: '工種ごとに合計行を表示' },
                { key: 'show_approver',   label: '上長印欄を表示' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={header[key]}
                    onChange={e => handleHeaderChange(key, e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-slate-600">{label}</span>
                </label>
              ))}
              <div className="mt-2">
                <Label>社印</Label>
                <select
                  value={header.stamp_header}
                  onChange={e => handleHeaderChange('stamp_header', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="company">社印</option>
                  <option value="representative">代表印</option>
                  <option value="none">表示しない</option>
                </select>
              </div>
            </div>
          </Section>

          {/* 消費税率 */}
          <Section title="消費税率">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={Math.round(Number(header.tax_rate) * 100)}
                onChange={e => handleHeaderChange('tax_rate', Number(e.target.value) / 100)}
                className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-500 text-sm">%</span>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
};

// ============================================================
// 明細テーブルコンポーネント
// ============================================================
const ItemTable = ({ items, showFixedFees, showSubtotals, categorySubtotals, onUpdateItem, onAddCategory, onAddItem, onRemoveRow, disabled }) => {
  // 工種ごとの小計表示用: 次の工種行または末尾の直前のitemを特定
  const isLastItemBeforeNext = (index) => {
    if (!showSubtotals) return false;
    const item = items[index];
    if (item.item_type !== 'item') return false;
    // 次の行がcategory, fixed, またはリスト末尾であれば最後のitem
    for (let j = index + 1; j < items.length; j++) {
      if (items[j].item_type === 'category' || items[j].item_type === 'fixed') return true;
      if (items[j].item_type === 'item') return false;
    }
    return true; // リスト末尾
  };

  // 直近の工種キーを取得
  const getCategoryKeyForIndex = (index) => {
    for (let i = index; i >= 0; i--) {
      if (items[i].item_type === 'category') {
        return items[i].id || items[i]._tempId || items[i].category_symbol;
      }
    }
    return null;
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-500">
              <th className="px-2 py-2 text-left w-6"></th>
              <th className="px-2 py-2 text-left min-w-32">名称</th>
              <th className="px-2 py-2 text-left min-w-40">仕様</th>
              <th className="px-2 py-2 text-right w-16">数量</th>
              <th className="px-2 py-2 text-left w-14">単位</th>
              <th className="px-2 py-2 text-right w-20">単価</th>
              <th className="px-2 py-2 text-right w-24">金額</th>
              <th className="px-2 py-2 text-left min-w-20">摘要</th>
              <th className="px-2 py-2 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              if (item.item_type === 'fixed' && !showFixedFees) return null;
              if (item.item_type === 'subtotal') return null; // subtotalはUI上では表示しない（保存時に自動生成）
              return (
                <React.Fragment key={item.id || item._tempId || index}>
                  <ItemRow
                    item={item}
                    index={index}
                    allItems={items}
                    onChange={(field, value) => onUpdateItem(index, field, value)}
                    onAddItem={() => onAddItem(index)}
                    onRemove={() => onRemoveRow(index)}
                    disabled={disabled}
                  />
                  {/* 工種小計のリアルタイム表示 */}
                  {isLastItemBeforeNext(index) && (() => {
                    const catKey = getCategoryKeyForIndex(index);
                    const subtotal = catKey ? (categorySubtotals[catKey] || 0) : 0;
                    return (
                      <tr className="bg-slate-50 border-b border-slate-300">
                        <td className="px-2 py-1.5"></td>
                        <td colSpan={5} className="px-2 py-1.5 text-right font-bold text-slate-600 text-xs pr-4">
                          合　計
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-slate-700 text-xs">
                          {formatCurrency(subtotal)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    );
                  })()}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 工種追加ボタン */}
      {!disabled && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onAddCategory}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-bold border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition"
          >
            <Plus size={15} />
            工種を追加
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================
// 明細行コンポーネント
// ============================================================
const ItemRow = ({ item, index, allItems, onChange, onAddItem, onRemove, disabled }) => {
  const [showUnitSug, setShowUnitSug] = useState(false);

  if (item.item_type === 'category') {
    return (
      <tr className="bg-blue-50 border-t border-blue-100">
        <td className="px-2 py-1.5 text-slate-400"><GripVertical size={14} /></td>
        <td colSpan={7} className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={item.category_symbol || ''}
              onChange={e => onChange('category_symbol', e.target.value)}
              className="w-8 border border-slate-300 rounded px-1 py-1 text-xs font-bold bg-white text-center"
              placeholder="A"
              disabled={disabled}
            />
            <input
              type="text"
              value={item.name || ''}
              onChange={e => onChange('name', e.target.value)}
              className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs font-bold bg-white"
              placeholder="工種名（例: 校舎・体育館）"
              disabled={disabled}
            />
            {!disabled && (
              <button
                onClick={onAddItem}
                title="この工種に細別追加"
                className="text-blue-500 hover:text-blue-700 ml-1"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5">
          {!disabled && (
            <button onClick={onRemove} className="text-red-400 hover:text-red-600">
              <Trash2 size={14} />
            </button>
          )}
        </td>
      </tr>
    );
  }

  if (item.item_type === 'fixed') {
    return (
      <tr className="bg-amber-50 border-t border-amber-100">
        <td className="px-2 py-1.5"></td>
        <td className="px-2 py-1.5 font-bold text-slate-600">{item.name}</td>
        <td className="px-2 py-1.5"></td>
        <td className="px-2 py-1.5 text-right text-slate-500">1.0</td>
        <td className="px-2 py-1.5 text-slate-500">式</td>
        <td className="px-2 py-1.5"></td>
        <td className="px-2 py-1.5">
          <input
            type="number"
            value={item.amount || ''}
            onChange={e => onChange('amount', e.target.value)}
            className="w-full border border-slate-300 rounded px-1 py-1 text-xs text-right bg-white"
            placeholder="0"
            disabled={disabled}
          />
        </td>
        <td colSpan={2} className="px-2 py-1.5"></td>
      </tr>
    );
  }

  // item行
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-2 py-1.5 text-slate-300"><GripVertical size={14} /></td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={item.name || ''}
          onChange={e => onChange('name', e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="名称"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={item.spec || ''}
          onChange={e => onChange('spec', e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="仕様"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          value={item.quantity || ''}
          onChange={e => onChange('quantity', e.target.value)}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="0"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5 relative">
        <input
          type="text"
          value={item.unit || ''}
          onChange={e => onChange('unit', e.target.value)}
          onFocus={() => !disabled && setShowUnitSug(true)}
          onBlur={() => setTimeout(() => setShowUnitSug(false), 150)}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="単位"
          disabled={disabled}
        />
        {showUnitSug && !disabled && (
          <div className="absolute top-full left-0 z-10 bg-white border border-slate-200 rounded shadow-lg py-1 min-w-max">
            {UNIT_SUGGESTIONS.map(u => (
              <button
                key={u}
                onMouseDown={() => onChange('unit', u)}
                className="block w-full text-left px-3 py-1 text-xs hover:bg-blue-50"
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          value={item.unit_price || ''}
          onChange={e => onChange('unit_price', e.target.value)}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="0"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          value={item.amount || ''}
          onChange={e => onChange('amount', e.target.value)}
          className="w-full border border-slate-200 rounded px-1 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50"
          placeholder="自動計算"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={item.note || ''}
          onChange={e => onChange('note', e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="摘要"
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
        {!disabled && (
          <button onClick={onRemove} className="text-red-400 hover:text-red-600">
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
};

// ============================================================
// 小さなUIパーツ
// ============================================================
const Section = ({ title, children }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-4">
    <h3 className="font-bold text-slate-700 text-sm mb-3 pb-2 border-b border-slate-100">
      {title}
    </h3>
    {children}
  </div>
);

const Label = ({ children, required }) => (
  <label className="block text-xs font-semibold text-slate-500 mb-1">
    {children}
    {required && <span className="text-red-400 ml-0.5">*</span>}
  </label>
);

const TotalRow = ({ label, value, bold, large }) => (
  <div className={`flex justify-between items-center ${bold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
    <span className={large ? 'text-base' : 'text-sm'}>{label}</span>
    <span className={`font-mono ${large ? 'text-lg text-blue-600' : ''}`}>
      ¥{formatCurrency(value)}-
    </span>
  </div>
);

export default EstimateForm;
