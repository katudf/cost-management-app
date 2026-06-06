// src/EstimateForm.jsx
// 見積書入力画面（ヘッダー + 明細）

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, FileText, Lock, Eye, RefreshCw, Download, X } from 'lucide-react';
import { BlobProvider } from '@react-pdf/renderer';
import ConfirmModal from './components/ConfirmModal';
import EstimateHeader from './components/estimate/EstimateHeader';
import EstimateItemTable from './components/estimate/EstimateItemTable';
import EstimateSidebar from './components/estimate/EstimateSidebar';
import EstimateDocument, { downloadEstimatePDF } from './EstimatePDF';
import {
  fetchEstimateById,
  createEstimate,
  updateEstimate,
  saveEstimateItems,
  fetchCustomers,
  fetchWorkers,
  getNextEstimateSeq,
  calcTotals,
  checkDuplicateNumber,
  fetchOfficeStaff,
  fetchSystemSettings,
} from './supabaseEstimates';
import { PROJECT_STATUS, ITEM_TYPE, ESTIMATE_STATUS, ESTIMATE_STATUS_LABEL } from './utils/constants';

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
  item_type: ITEM_TYPE.ITEM,
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
  item_type: ITEM_TYPE.CATEGORY,
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
  { item_type: ITEM_TYPE.FIXED, name: '法定福利費', quantity: 1, unit: '式', amount: '', note: '' },
  { item_type: ITEM_TYPE.FIXED, name: '安全費',     quantity: 1, unit: '式', amount: '', note: '' },
];

const newCommentRow = (sortOrder) => ({
  item_type: ITEM_TYPE.COMMENT,
  name: '',
  spec: null,
  quantity: null,
  unit: null,
  unit_price: null,
  amount: null,
  note: null,
  sort_order: sortOrder,
  _tempId: `comment_${Date.now()}_${Math.random()}`,
});

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
    status: ESTIMATE_STATUS.DRAFT,
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
  const [settings, setSettings] = useState({});

  // UI state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [numberError, setNumberError] = useState('');
  const [originalStatus, setOriginalStatus] = useState(ESTIMATE_STATUS.DRAFT);

  // プレビュー state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState(null); // プレビュー用データスナップショット
  const [previewKey, setPreviewKey] = useState(0);             // 変更時にBlobProviderを強制再生成

  // 未保存変更の追跡
  const isDirty = useRef(false);
  const isInitialized = useRef(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

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
        const [custData, workerData, staffData, settingsData] = await Promise.all([
          fetchCustomers(),
          fetchWorkers(),
          fetchOfficeStaff(),
          fetchSystemSettings(),
        ]);
        setCustomers(custData);
        setWorkers(workerData);
        setOfficeStaff(staffData);
        setSettings(settingsData);

        if (isNew) {
          const prefix = todayPrefix();
          const seq = await getNextEstimateSeq(prefix);
          setHeader(h => ({
            ...h,
            estimate_number_date: prefix,
            estimate_number_seq: seq,
            customer_honorific: '御中',
            notes: '※別紙項目に無い塗装工事は別途追加見積り申し上げます。',
          }));
          setOriginalStatus(ESTIMATE_STATUS.DRAFT);
          setItems([
            { ...newCategoryRow(0), category_symbol: 'A', name: '' },
            { ...newItemRow(null, null, 1) },
            ...fixedRows.map((r, i) => ({ ...r, sort_order: 100 + i })),
          ]);
        } else {
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
            status:         est.status || ESTIMATE_STATUS.DRAFT,
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
          // DBで '__comment__' としてエンコードされたコメント行を復元
          const loadedItems = (est.items || []).map(item =>
            item.item_type === ITEM_TYPE.ITEM && item.category_symbol === '__comment__'
              ? { ...item, item_type: ITEM_TYPE.COMMENT, category_symbol: null }
              : item
          );
          setItems(loadedItems);
          setOriginalStatus(est.status || ESTIMATE_STATUS.DRAFT);
        }
      } catch (e) {
        setError('データの読み込みに失敗しました: ' + e.message);
      } finally {
        setLoading(false);
        isInitialized.current = true;
      }
    };
    init();
  }, [estimateId, isNew]);

  useEffect(() => {
    if (!isInitialized.current) return;
    isDirty.current = true;
  }, [header, items]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!isDirty.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ============================================================
  // ヘッダー入力ハンドラ
  // ============================================================
  const handleHeaderChange = useCallback((field, value) => {
    setHeader(h => ({ ...h, [field]: value }));
  }, []);

  // ============================================================
  // 明細操作
  // ============================================================
  const addCategory = () => {
    const categories = items.filter(i => i.item_type === ITEM_TYPE.CATEGORY);
    const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nextSymbol = symbols[categories.length] || '';
    const newRow = {
      ...newCategoryRow(items.length),
      category_symbol: nextSymbol,
    };
    setItems(prev => [...prev.filter(i => i.item_type !== ITEM_TYPE.FIXED), newRow,
      newItemRow(null, null, items.length + 1),
      ...prev.filter(i => i.item_type === ITEM_TYPE.FIXED),
    ]);
  };

  const addItem = (afterIndex) => {
    const newRow = newItemRow(null, null, afterIndex + 1);
    setItems(prev => {
      const next = [...prev];
      next.splice(afterIndex + 1, 0, newRow);
      return next.map((r, i) => ({ ...r, sort_order: i }));
    });
  };

  // コメント行をFIXED行の直前に追加
  const addComment = () => {
    setItems(prev => {
      const nonFixed = prev.filter(i => i.item_type !== ITEM_TYPE.FIXED);
      const fixed = prev.filter(i => i.item_type === ITEM_TYPE.FIXED);
      const newRow = newCommentRow(nonFixed.length);
      return [...nonFixed, newRow, ...fixed].map((r, i) => ({ ...r, sort_order: i }));
    });
  };

  const removeRow = (index) => {
    setItems(prev => {
      const target = prev[index];
      if (target.item_type === ITEM_TYPE.CATEGORY) {
        let end = index + 1;
        while (end < prev.length && prev[end].item_type === ITEM_TYPE.ITEM) end++;
        return prev.filter((_, i) => i < index || i >= end);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // ドラッグ並び替え・コピー・一括削除など、items配列全体を置き換えるコールバック
  const setAllItems = useCallback((newItems) => {
    setItems(newItems);
  }, []);

  // ============================================================
  // PDFプレビュー用データ構築
  // ============================================================
  const buildPreviewEstimate = useCallback(() => {
    const customer = customers.find(c => String(c.id) === String(header.customer_id)) || null;
    const staff    = officeStaff.find(s => String(s.id) === String(header.staff_id))  || null;

    // COMMENT行をエンコード、SUBTOTALを除去
    let pdfItems = items
      .filter(i => i.item_type !== ITEM_TYPE.SUBTOTAL)
      .map(({ _tempId, ...item }) => {
        if (item.item_type === ITEM_TYPE.COMMENT) {
          return { ...item, item_type: ITEM_TYPE.ITEM, category_symbol: '__comment__' };
        }
        return item;
      });

    // show_subtotals ON の場合は小計行を動的生成
    if (header.show_subtotals) {
      const withSubtotals = [];
      let currentCatKey = null;
      let catAmount = 0;
      pdfItems.forEach((item, idx) => {
        if (item.item_type === ITEM_TYPE.CATEGORY) {
          if (currentCatKey !== null) {
            withSubtotals.push({ item_type: ITEM_TYPE.SUBTOTAL, name: '合　計', amount: catAmount, sort_order: withSubtotals.length });
          }
          currentCatKey = item.id || item._tempId || idx;
          catAmount = 0;
        } else if (item.item_type === ITEM_TYPE.ITEM) {
          catAmount += Number(item.amount) || 0;
        }
        withSubtotals.push(item);
      });
      if (currentCatKey !== null) {
        withSubtotals.push({ item_type: ITEM_TYPE.SUBTOTAL, name: '合　計', amount: catAmount, sort_order: withSubtotals.length });
      }
      pdfItems = withSubtotals;
    }

    return {
      ...header,
      estimate_number: estimateNumber,
      customer,
      staff,
      items: pdfItems,
      tax_rate:   Number(header.tax_rate),
      net_perc:   Number(header.net_perc),
      net_amount: header.net_amount !== '' ? Number(header.net_amount) : null,
    };
  }, [header, items, customers, officeStaff, estimateNumber]);

  const handleOpenPreview = useCallback(() => {
    setPreviewSnapshot(buildPreviewEstimate());
    setPreviewKey(0);
    setPreviewOpen(true);
  }, [buildPreviewEstimate]);

  const handleRefreshPreview = useCallback(() => {
    setPreviewSnapshot(buildPreviewEstimate());
    setPreviewKey(k => k + 1);
  }, [buildPreviewEstimate]);

  // Escape キーでプレビューを閉じる
  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);

  const updateItem = useCallback((index, field, value) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
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
    i.item_type === ITEM_TYPE.ITEM ||
    (i.item_type === ITEM_TYPE.FIXED && header.show_fixed_fees)
  );
  const totals = calcTotals(visibleItems, Number(header.tax_rate), {
    type: header.net_calc_type,
    perc: header.net_perc,
    manualAmount: header.net_amount
  });

  // ============================================================
  // 編集ロック判定
  // ============================================================
  const isLocked = !isNew && originalStatus !== ESTIMATE_STATUS.DRAFT;

  const handleUnlock = async () => {
    try {
      setSaving(true);
      await updateEstimate(estimateId, { status: ESTIMATE_STATUS.DRAFT });
      setHeader(h => ({ ...h, status: ESTIMATE_STATUS.DRAFT }));
      setOriginalStatus(ESTIMATE_STATUS.DRAFT);
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
      if (item.item_type === ITEM_TYPE.CATEGORY) {
        currentCatKey = item.id || item._tempId || item.category_symbol;
        result[currentCatKey] = 0;
      } else if (item.item_type === ITEM_TYPE.ITEM && currentCatKey) {
        result[currentCatKey] += Number(item.amount) || 0;
      }
    });
    return result;
  }, [items]);

  // ============================================================
  // 保存処理
  // ============================================================
  const handleSave = async () => {
    if (isLocked) { setError('提出済み以降の見積書は編集できません。「下書きに戻す」を実行してください。'); return; }
    if (!header.customer_id) { setError('顧客を選択してください'); return; }
    if (!header.title.trim()) { setError('工事名を入力してください'); return; }
    if (!estimateNumber.match(/^\d{6}-\d{4}-\d{3}$/)) {
      setNumberError('形式: YYMMDD-NNNN-NNN');
      return;
    }

    const categories = items.filter(i => i.item_type === ITEM_TYPE.CATEGORY);
    let catIdx = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].item_type === ITEM_TYPE.CATEGORY) {
        const catName = items[i].name || items[i].category_symbol || `工種${catIdx + 1}`;
        let hasItem = false;
        for (let j = i + 1; j < items.length; j++) {
          if (items[j].item_type === ITEM_TYPE.CATEGORY) break;
          if (items[j].item_type === ITEM_TYPE.ITEM && items[j].name?.trim()) { hasItem = true; break; }
        }
        if (!hasItem) {
          setError(`「${catName}」に細別を最低1件追加してください。`);
          return;
        }
        catIdx++;
      }
    }

    if (items.length > MAX_ROWS) {
      setError(`明細行数が上限（${MAX_ROWS}行）を超えています。現在 ${items.length} 行です。`);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setNumberError('');

      const isDuplicate = await checkDuplicateNumber(estimateNumber, estimateId || null);
      if (isDuplicate) {
        setNumberError(`見積番号「${estimateNumber}」は既に使用されています。`);
        setSaving(false);
        return;
      }

      let finalItems = [...items];
      finalItems = finalItems.filter(i => i.item_type !== ITEM_TYPE.SUBTOTAL);
      if (header.show_subtotals) {
        const withSubtotals = [];
        let currentCatKey = null;
        let catAmount = 0;
        finalItems.forEach((item, idx) => {
          if (item.item_type === ITEM_TYPE.CATEGORY) {
            if (currentCatKey !== null) {
              withSubtotals.push({
                item_type: ITEM_TYPE.SUBTOTAL,
                name: '合　計',
                amount: catAmount,
                sort_order: withSubtotals.length,
              });
            }
            currentCatKey = item.id || item._tempId || idx;
            catAmount = 0;
          } else if (item.item_type === ITEM_TYPE.ITEM) {
            catAmount += Number(item.amount) || 0;
          }
          withSubtotals.push(item);
        });
        if (currentCatKey !== null) {
          withSubtotals.push({
            item_type: ITEM_TYPE.SUBTOTAL,
            name: '合　計',
            amount: catAmount,
            sort_order: withSubtotals.length,
          });
        }
        finalItems = withSubtotals;
      }

      const savingVisibleItems = finalItems.filter(i =>
        i.item_type === ITEM_TYPE.ITEM ||
        (i.item_type === ITEM_TYPE.FIXED && header.show_fixed_fees)
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

      const saveableItems = finalItems
        .filter(i => i.name?.trim())
        .map(({ _tempId, ...i }) => {
          // COMMENT行はDB制約上 item_type:'item' + category_symbol:'__comment__' としてエンコード
          const isComment = i.item_type === ITEM_TYPE.COMMENT;
          return {
            ...i,
            item_type:       isComment ? ITEM_TYPE.ITEM : i.item_type,
            category_symbol: isComment ? '__comment__'  : i.category_symbol,
            estimate_id: savedId,
            quantity:   i.quantity !== '' && i.quantity != null ? Number(i.quantity) : null,
            unit_price: i.unit_price !== '' && i.unit_price != null ? Number(i.unit_price) : null,
            amount:     i.amount !== '' && i.amount != null ? Number(i.amount) : null,
          };
        });
      await saveEstimateItems(savedId, saveableItems);

      // 「承認」時の自動連動（Projectsテーブルへのコピー）
      if (header.status === ESTIMATE_STATUS.APPROVED && originalStatus !== ESTIMATE_STATUS.APPROVED) {
        try {
          const { supabase } = await import('./lib/supabase');
          const { data: existing } = await supabase
            .from('Projects')
            .select('id')
            .eq('name', header.title)
            .eq('customerId', header.customer_id)
            .limit(1);

          if (!existing || existing.length === 0) {
            const { data: maxOrder } = await supabase
              .from('Projects')
              .select('order')
              .order('order', { ascending: false })
              .limit(1);
            const nextOrder = (maxOrder?.[0]?.order || 0) + 1;
            await supabase.from('Projects').insert([{
              name: header.title,
              customerId: header.customer_id,
              status: PROJECT_STATUS.ESTIMATE,
              order: nextOrder
            }]);
          }
        } catch (syncErr) {
          console.error('工事マスタへの連携に失敗しました:', syncErr);
        }
      }

      setOriginalStatus(header.status);
      isDirty.current = false;
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
    return <div className="p-6 text-center text-slate-400">読み込み中...</div>;
  }

  return (
    <div className="p-4 md:p-6">

      {/* ページヘッダー */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button
          onClick={() => isDirty.current ? setShowLeaveConfirm(true) : onBack()}
          aria-label="一覧に戻る"
          title="一覧に戻る"
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
        <button
          onClick={handleOpenPreview}
          title="PDFプレビューを表示"
          aria-label="PDFプレビュー"
          className="ml-auto flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-400 bg-white px-3 py-1.5 rounded-lg transition font-medium"
        >
          <Eye size={15} />
          プレビュー
        </button>
      </div>

      {/* 編集ロックバナー */}
      {isLocked && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-2">
          <Lock size={16} />
          この見積書は「{ESTIMATE_STATUS_LABEL[originalStatus] || originalStatus}」のため編集できません。編集するには「下書きに戻す」を実行してください。
        </div>
      )}

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">

        {/* ===== 左・メインカラム ===== */}
        <div className="space-y-4 min-w-0">
          <EstimateHeader
            isNew={isNew}
            header={header}
            onChange={handleHeaderChange}
            customers={customers}
            officeStaff={officeStaff}
            estimateNumber={estimateNumber}
            numberError={numberError}
            disabled={isLocked}
          />
          <EstimateItemTable
            items={items}
            showFixedFees={header.show_fixed_fees}
            showSubtotals={header.show_subtotals}
            categorySubtotals={categorySubtotals}
            onUpdateItem={updateItem}
            onAddCategory={addCategory}
            onAddItem={addItem}
            onAddComment={addComment}
            onRemoveRow={removeRow}
            onSetItems={setAllItems}
            disabled={isLocked}
          />
          {items.length > MAX_ROWS && (
            <p className="text-red-500 text-xs font-bold">⚠ 行数が上限（{MAX_ROWS}行）を超えています</p>
          )}
        </div>

        {/* ===== 右サイドバー ===== */}
        <div className="w-full">
          <EstimateSidebar
            totals={totals}
            header={header}
            onChange={handleHeaderChange}
            saving={saving}
            isLocked={isLocked}
            onSave={handleSave}
            onUnlock={handleUnlock}
          />
        </div>
      </div>

      {/* ===== PDFプレビューオーバーレイ ===== */}
      {previewOpen && (
        <div className="fixed inset-0 z-[9999] flex flex-col" style={{ background: 'rgba(15,23,42,0.82)' }}>

          {/* ツールバー */}
          <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
            <FileText size={17} className="text-blue-600 shrink-0" />
            <span className="font-bold text-slate-700 text-sm flex-1">PDFプレビュー</span>
            <p className="text-xs text-slate-400 hidden sm:block">
              ※ 最新の入力内容は「最新化」ボタンで反映
            </p>
            <button
              onClick={handleRefreshPreview}
              title="現在の入力内容でプレビューを更新"
              aria-label="プレビューを最新化"
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition font-bold"
            >
              <RefreshCw size={14} />
              最新化
            </button>
            <button
              onClick={() => previewSnapshot && downloadEstimatePDF(previewSnapshot, settings)}
              title="PDFをダウンロード（新規タブで開く）"
              aria-label="PDFをダウンロード"
              className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-400 px-3 py-1.5 rounded-lg transition"
            >
              <Download size={14} />
              DL
            </button>
            <button
              onClick={() => setPreviewOpen(false)}
              title="プレビューを閉じる（Esc）"
              aria-label="プレビューを閉じる"
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"
            >
              <X size={18} />
            </button>
          </div>

          {/* PDF表示エリア */}
          <div className="flex-1 overflow-hidden">
            {previewSnapshot ? (
              <BlobProvider
                key={previewKey}
                document={<EstimateDocument estimate={previewSnapshot} settings={settings} />}
              >
                {({ url, loading, error: pdfError }) => {
                  if (loading) {
                    return (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-center text-white">
                          <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" style={{ borderWidth: 3 }} />
                          <p className="text-sm font-medium">PDF を生成中...</p>
                          <p className="text-xs text-white/60 mt-1">しばらくお待ちください</p>
                        </div>
                      </div>
                    );
                  }
                  if (pdfError) {
                    return (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="bg-white rounded-xl p-8 max-w-sm text-center shadow-xl">
                          <p className="text-red-500 font-bold mb-2">PDF 生成エラー</p>
                          <p className="text-slate-500 text-sm">{pdfError.message}</p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <iframe
                      src={url}
                      title="見積書プレビュー"
                      className="w-full h-full"
                      style={{ border: 'none', display: 'block' }}
                    />
                  );
                }}
              </BlobProvider>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/60">
                データがありません
              </div>
            )}
          </div>
        </div>
      )}

      {/* 未保存変更の離脱確認モーダル */}
      <ConfirmModal
        isOpen={showLeaveConfirm}
        onClose={() => setShowLeaveConfirm(false)}
        onConfirm={() => { setShowLeaveConfirm(false); isDirty.current = false; onBack(); }}
        title="変更を破棄しますか？"
        message="保存されていない変更があります。一覧に戻ると変更内容が失われます。"
        confirmText="破棄して戻る"
        cancelText="編集を続ける"
      />
    </div>
  );
};

export default EstimateForm;
