// src/EstimateForm.jsx
// 見積書入力画面（ヘッダー + 明細）

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, FileText, Lock, Eye, RefreshCw, Download, X, AlertCircle } from 'lucide-react';
import { BlobProvider } from '@react-pdf/renderer';
import ConfirmModal from './components/ConfirmModal';
import EstimateHeader from './components/estimate/EstimateHeader';
import EstimateItemTable from './components/estimate/EstimateItemTable';
import EstimateSidebar from './components/estimate/EstimateSidebar';
import ImportItemsModal from './components/estimate/ImportItemsModal';
import EstimateDocument, { downloadEstimatePDF } from './EstimatePDF';
import { useToast } from './components/Toast';
import { useAuth } from './hooks/useAuth';
import {
  fetchEstimateById,
  createEstimate,
  updateEstimate,
  approveEstimate,
  returnEstimate,
  saveEstimateItems,
  syncEstimateToProject,
  fetchCustomers,
  createCustomer,
  fetchWorkers,
  getNextEstimateSeq,
  calcTotals,
  formatCurrency,
  checkDuplicateNumber,
  findAvailableBranchNumber,
  fetchOfficeStaff,
  fetchSystemSettings,
} from './supabaseEstimates';
import { ITEM_TYPE, ESTIMATE_STATUS, ESTIMATE_STATUS_LABEL } from './utils/constants';
import {
  saveEstimateDraft,
  loadEstimateDraft,
  clearEstimateDraft,
  formatDraftAge,
} from './utils/estimateDraft';
import { addDays, toDateStr } from './utils/dateUtils';

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
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
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
const EstimateForm = ({ estimateId, onBack, onSaved, onStatusChanged }) => {
  const isNew = !estimateId;
  const { showToast } = useToast();
  const { currentStaff } = useAuth();

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
    approved_by: '',
    approved_at: '',
    returned_reason: '',
    approver_staff_id: null,
    project_id: null,
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
  const [itemTableFullscreen, setItemTableFullscreen] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState(null); // プレビュー用データスナップショット
  const [previewKey, setPreviewKey] = useState(0);             // 変更時にBlobProviderを強制再生成
  const [previewStale, setPreviewStale] = useState(false);     // プレビュー表示後に入力が変更されたか

  // 未保存変更の追跡
  const isDirty = useRef(false);
  const isInitialized = useRef(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // 過去見積からの明細取込モーダル
  const [showImportModal, setShowImportModal] = useState(false);

  // 自動退避（localStorage）からの復元プロンプト
  const [pendingDraft, setPendingDraft] = useState(null); // { header, items, savedAt } | null

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
          const validDays = Number(settingsData.est_default_valid_days) || 30;
          setHeader(h => ({
            ...h,
            estimate_number_date: prefix,
            estimate_number_seq: seq,
            customer_honorific: '御中',
            notes: '※別紙項目に無い塗装工事は別途追加見積り申し上げます。',
            valid_until: toDateStr(addDays(h.issue_date, validDays)),
            staff_id: currentStaff?.id ? String(currentStaff.id) : h.staff_id,
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
            approved_by:     est.approved_by || '',
            approved_at:     est.approved_at || '',
            returned_reason: est.returned_reason || '',
            approver_staff_id: est.approver_staff_id || null,
            project_id:      est.project_id || null,
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

        // 前回の未保存入力が退避されていれば復元を提案する。
        const draft = loadEstimateDraft(estimateId);
        if (draft) {
          setPendingDraft(draft);
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

  // 入力内容を localStorage へ自動退避（debounce 1.5秒）。
  // ・初期化前は退避しない（読み込み直後のDB値で上書きしない）
  // ・復元プロンプト表示中は退避しない（ユーザー判断前に退避を上書きしない）
  // ・ロック中（下書き以外）は編集不可のため退避不要
  useEffect(() => {
    if (!isInitialized.current) return;
    if (pendingDraft) return;
    if (!isNew && originalStatus !== ESTIMATE_STATUS.DRAFT) return;
    if (!isDirty.current) return;

    const timer = setTimeout(() => {
      saveEstimateDraft(estimateId, { header, items });
    }, 1500);
    return () => clearTimeout(timer);
  }, [header, items, estimateId, isNew, originalStatus, pendingDraft]);

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

  // 顧客ドロップダウンからの新規顧客登録（登録後は自動選択する）
  const handleCreateCustomer = useCallback(async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    try {
      const created = await createCustomer(trimmed);
      setCustomers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'ja')));
      setHeader(h => ({ ...h, customer_id: created.id }));
      showToast('新規顧客を登録しました', 'success');
      return created;
    } catch (e) {
      showToast('顧客の登録に失敗しました: ' + e.message, 'error');
      return null;
    }
  }, [showToast]);

  // ステータス変更系の操作は、画面遷移で失われないようその場でSupabaseへ反映する
  const persistStatus = useCallback(async (patch) => {
    try {
      setSaving(true);
      await updateEstimate(estimateId, patch);
      setHeader(h => ({ ...h, ...patch }));

      // 「受注」への遷移時はProjectsテーブルへ連携する（handleSave経由の保存を通らない
      // ステータスバッジ操作のため、ここでも同じ連携処理を行う必要がある）
      if (patch.status === ESTIMATE_STATUS.ORDERED && originalStatus !== ESTIMATE_STATUS.ORDERED) {
        try {
          const linkedProjectId = await syncEstimateToProject({
            projectId: header.project_id || null,
            title: header.title,
            customerId: header.customer_id,
          });
          if (linkedProjectId !== header.project_id) {
            await updateEstimate(estimateId, { project_id: linkedProjectId });
            setHeader(prev => ({ ...prev, project_id: linkedProjectId }));
          }
        } catch (syncErr) {
          console.error('工事マスタへの連携に失敗しました:', syncErr);
          showToast(
            'ステータスは更新しましたが、工事案件への連携に失敗しました。工事一覧から手動で登録してください。',
            'error'
          );
        }
      }

      onStatusChanged?.();
    } catch (e) {
      setError('ステータスの変更に失敗しました: ' + e.message);
    } finally {
      setSaving(false);
    }
  }, [estimateId, onStatusChanged, header.project_id, header.title, header.customer_id, originalStatus, showToast]);

  // 承認・差し戻し（SECURITY DEFINER RPC経由。証跡カラムはDB側で記録される）
  // 指名された承認者本人のみ実行できる制約はDB側（approve_estimate / return_estimate）で強制。
  // UI側のガード（EstimateSidebar）は補助的な二重チェック
  const handleApprove = useCallback(async () => {
    try {
      setSaving(true);
      const trail = await approveEstimate(estimateId);
      setHeader(h => ({ ...h, ...trail }));
      onStatusChanged?.();
    } catch (e) {
      setError('承認に失敗しました: ' + e.message);
    } finally {
      setSaving(false);
    }
  }, [estimateId, onStatusChanged]);

  const handleReturn = useCallback(async (reason) => {
    try {
      setSaving(true);
      const trail = await returnEstimate(estimateId, reason);
      setHeader(h => ({ ...h, ...trail }));
      onStatusChanged?.();
    } catch (e) {
      setError('差し戻しに失敗しました: ' + e.message);
    } finally {
      setSaving(false);
    }
  }, [estimateId, onStatusChanged]);

  // 申請中（承認依頼）: 承認者を指名してステータスを申請中にする
  const handleSubmit = useCallback((approverStaffId) => {
    persistStatus({
      status: ESTIMATE_STATUS.PENDING,
      approver_staff_id: approverStaffId,
      returned_reason: '',
    });
  }, [persistStatus]);

  const handleSubmitToCustomer = useCallback(() => {
    persistStatus({ status: ESTIMATE_STATUS.SUBMITTED });
  }, [persistStatus]);

  const handleOrder = useCallback(() => {
    persistStatus({ status: ESTIMATE_STATUS.ORDERED, lost_reason: '' });
  }, [persistStatus]);

  const handleLose = useCallback((reason) => {
    persistStatus({ status: ESTIMATE_STATUS.LOST, lost_reason: reason });
  }, [persistStatus]);

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

  // 過去見積から選択した工種グループを、現在の明細末尾（FIXED行の手前）に取込む
  const handleImportGroups = (groups) => {
    setItems(prev => {
      const nonFixed = prev.filter(i => i.item_type !== ITEM_TYPE.FIXED);
      const fixed = prev.filter(i => i.item_type === ITEM_TYPE.FIXED);
      const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const existingCatCount = nonFixed.filter(i => i.item_type === ITEM_TYPE.CATEGORY).length;

      const imported = [];
      groups.forEach((g, gIdx) => {
        imported.push({
          ...newCategoryRow(0),
          category_symbol: symbols[existingCatCount + gIdx] || '',
          name: g.category?.name || '',
        });
        g.rows.forEach(row => {
          imported.push({
            ...newItemRow(null, null, 0),
            name: row.name || '',
            spec: row.spec || '',
            quantity: row.quantity ?? '',
            unit: row.unit || '',
            unit_price: row.unit_price ?? '',
            amount: row.amount ?? '',
            note: row.note || '',
          });
        });
      });

      return [...nonFixed, ...imported, ...fixed].map((r, i) => ({ ...r, sort_order: i }));
    });
    setShowImportModal(false);
    showToast('過去見積から明細を取込みました', 'success');
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
    setPreviewStale(false);
    setPreviewOpen(true);
  }, [buildPreviewEstimate]);

  const handleRefreshPreview = useCallback(() => {
    setPreviewSnapshot(buildPreviewEstimate());
    setPreviewKey(k => k + 1);
    setPreviewStale(false);
  }, [buildPreviewEstimate]);

  // プレビュー表示中に入力が変更されたら「最新化」を促すインジケーターを出す
  useEffect(() => {
    if (!previewOpen) return;
    setPreviewStale(true);
  }, [header, items]);

  // Escape キーでプレビューを閉じる
  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);

  // Escape キーで見積内訳明細の全画面表示を閉じる
  useEffect(() => {
    if (!itemTableFullscreen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setItemTableFullscreen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [itemTableFullscreen]);

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
  // 担当者(staff_id)未設定の見積書は作成者チェック対象外とし、誰でも編集可能とする
  const isCreator = !header.staff_id || String(header.staff_id) === String(currentStaff?.id);
  const creatorStaff = officeStaff.find(s => String(s.id) === String(header.staff_id)) || null;

  const handleUnlock = async () => {
    if (!isCreator) return;
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
        lost_reason:    header.lost_reason || null,
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
        approved_by:     header.approved_by || null,
        approved_at:     header.approved_at || null,
        returned_reason: header.returned_reason || null,
        approver_staff_id: header.approver_staff_id || null,
        project_id:      header.project_id || null,
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

      // 「受注」時の自動連動（Projectsテーブルへのコピー）
      // 見積本体は保存済みのため、連携失敗時は保存を成功扱いにしつつ
      // ユーザーへ通知して手動対応を促す（工事案件が作られないまま施工が
      // 始まる事故を防ぐ）。
      // estimates.project_id で連携先を記録し、以後の再受注では同じ案件を使い回す
      // （工事名変更後の再受注で重複作成されるのを防ぐ）。
      if (header.status === ESTIMATE_STATUS.ORDERED && originalStatus !== ESTIMATE_STATUS.ORDERED) {
        try {
          const linkedProjectId = await syncEstimateToProject({
            projectId: header.project_id || null,
            title: header.title,
            customerId: header.customer_id,
          });
          if (linkedProjectId !== header.project_id) {
            await updateEstimate(savedId, { project_id: linkedProjectId });
            setHeader(prev => ({ ...prev, project_id: linkedProjectId }));
          }
        } catch (syncErr) {
          console.error('工事マスタへの連携に失敗しました:', syncErr);
          showToast(
            '見積は保存しましたが、工事案件への連携に失敗しました。工事一覧から手動で登録してください。',
            'error'
          );
        }
      }

      setOriginalStatus(header.status);
      isDirty.current = false;
      // DB保存が成功したので退避データは破棄する。
      // 退避キーは新規作成時 'new'（estimateId=undefined）、既存は estimateId。
      // このフォームインスタンスが使った退避キーと一致するため estimateId で掃除できる。
      clearEstimateDraft(estimateId);
      onSaved?.();
    } catch (e) {
      // 23505 = Postgres unique_violation。事前チェックと保存実行の間に
      // 他ユーザーが同一番号で保存した競合ウィンドウのケース。
      if (e.code === '23505') {
        setNumberError(`見積番号「${estimateNumber}」は他のユーザーによって使用されました。再採番してください。`);
      } else {
        setError('保存に失敗しました: ' + e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  // 見積番号の競合時、空いている枝番を自動で探して採番し直す
  const handleReissueNumber = async () => {
    try {
      setNumberError('');
      const newBranch = await findAvailableBranchNumber(
        header.estimate_number_date,
        header.estimate_number_seq,
        Number(header.estimate_number_branch) || 1
      );
      const branchPart = newBranch.split('-')[2];
      setHeader(h => ({ ...h, estimate_number_branch: branchPart }));
    } catch (e) {
      showToast('再採番に失敗しました: ' + e.message, 'error');
    }
  };

  // ============================================================
  // 自動退避データの復元／破棄
  // ============================================================
  // 退避データを現在のフォームへ反映する。isInitialized は true のままなので
  // この setHeader/setItems は dirty 扱いになり、以降の自動退避も再開する。
  const handleRestoreDraft = () => {
    if (pendingDraft) {
      setHeader(pendingDraft.header);
      setItems(pendingDraft.items);
      isDirty.current = true;
    }
    setPendingDraft(null);
  };

  // 退避を使わず破棄。DBから読み込んだ内容のまま編集を続ける。
  const handleDiscardDraft = () => {
    clearEstimateDraft(estimateId);
    setPendingDraft(null);
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
        {!isNew && creatorStaff && (
          <span className="text-xs text-slate-500">
            作成者: <span className="font-bold text-slate-600">{creatorStaff.name}</span>
          </span>
        )}
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

      {/* 編集ロックバナー（作成者のみ表示） */}
      {isLocked && isCreator && (
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
            onCreateCustomer={handleCreateCustomer}
            officeStaff={officeStaff}
            estimateNumber={estimateNumber}
            numberError={numberError}
            onReissueNumber={handleReissueNumber}
            disabled={isLocked}
          />
          {!itemTableFullscreen && (
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
              onImportItems={() => setShowImportModal(true)}
              disabled={isLocked}
              isFullscreen={false}
              onToggleFullscreen={() => setItemTableFullscreen(true)}
            />
          )}
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
            officeStaff={officeStaff}
            currentStaff={currentStaff}
            onApprove={handleApprove}
            onReturn={handleReturn}
            onSubmit={handleSubmit}
            onSubmitToCustomer={handleSubmitToCustomer}
            onOrder={handleOrder}
            onLose={handleLose}
          />
        </div>
      </div>

      {/* ===== 見積内訳明細 全画面オーバーレイ ===== */}
      {itemTableFullscreen && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-100">
          <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
            <FileText size={17} className="text-blue-600 shrink-0" />
            <div className="flex flex-col gap-1">
              <span className="font-bold text-slate-700 text-sm">見積内訳明細（全画面表示）</span>
              <span className="text-xs text-slate-600">{header.title || '（工事名未入力）'}</span>
            </div>
            <div className="flex items-center gap-4 ml-auto mr-2">
              <span className="text-sm text-slate-500">
                工事費 <span className="font-mono font-bold text-slate-700">¥{formatCurrency(totals.subtotal)}-</span>
              </span>
              <span className="text-sm text-slate-500">
                税込 <span className="font-mono font-bold text-blue-600">¥{formatCurrency(totals.total)}-</span>
              </span>
            </div>
            <button
              onClick={() => setItemTableFullscreen(false)}
              title="全画面表示を閉じる（Esc）"
              aria-label="全画面表示を閉じる"
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-4">
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
              onImportItems={() => setShowImportModal(true)}
              disabled={isLocked}
              isFullscreen={true}
              onToggleFullscreen={() => setItemTableFullscreen(false)}
            />
          </div>
        </div>
      )}

      {/* ===== PDFプレビューオーバーレイ ===== */}
      {previewOpen && (
        <div className="fixed inset-0 z-[9999] flex flex-col" style={{ background: 'rgba(15,23,42,0.82)' }}>

          {/* ツールバー */}
          <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
            <FileText size={17} className="text-blue-600 shrink-0" />
            <span className="font-bold text-slate-700 text-sm flex-1">PDFプレビュー</span>
            {previewStale && (
              <span className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
                <AlertCircle size={12} />
                入力が変更されています
              </span>
            )}
            <p className="text-xs text-slate-400 hidden sm:block">
              ※ 最新の入力内容は「最新化」ボタンで反映
            </p>
            <button
              onClick={handleRefreshPreview}
              title="現在の入力内容でプレビューを更新"
              aria-label="プレビューを最新化"
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition font-bold border ${
                previewStale
                  ? 'text-amber-700 bg-amber-50 border-amber-300 hover:border-amber-400'
                  : 'text-blue-600 border-blue-200 hover:text-blue-800 hover:border-blue-400'
              }`}
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

      {/* 自動退避データの復元プロンプト */}
      <ConfirmModal
        isOpen={!!pendingDraft}
        onClose={handleDiscardDraft}
        onConfirm={handleRestoreDraft}
        title="入力途中のデータがあります"
        message={
          pendingDraft
            ? `${formatDraftAge(pendingDraft.savedAt)}に自動退避された未保存の入力内容が見つかりました。復元しますか？（破棄すると保存済みの内容で編集を続けます）`
            : ''
        }
        confirmText="復元する"
        cancelText="破棄する"
        variant="primary"
      />

      {/* 過去見積からの明細取込モーダル */}
      {showImportModal && (
        <ImportItemsModal
          currentEstimateId={estimateId}
          onImport={handleImportGroups}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
};

export default EstimateForm;
