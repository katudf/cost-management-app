// src/estimate-editor/EstimateEditor.jsx
// 見積WYSIWYGエディタ本体（Phase 3: 骨格）。
//
// 旧 EstimateForm.jsx のロジック（初期化 / 自動退避 / dirty追跡 / ステータス系 /
// 編集ロック / 番号再採番 / 保存）を、シートモデル（design.md §5）へ移植したもの。
// マウント契約 `({ estimateId, onBack, onSaved, onStatusChanged })` は旧フォームと同一。
//
// Phase 3 の範囲:
//   - 紙面スタック表示（鑑インライン編集 CoverPaper ＋ 読み取り専用 SheetPaper）
//   - 左ナビ PageNav（シート移動・追加・削除）／右 SettingsPanel（設定・ステータス操作）
//   - 保存ラウンドトリップ（buildSaveItemsPayload → saveEstimateItemsV2 → sheet_id再マップ）
//   - PDFプレビューは暫定で全シートをフラット化し旧 EstimateDocument に渡す（Phase 6で本対応）
// 明細セル編集は Phase 4、計算・リンクエンジンは Phase 5 で実装する。

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, FileText, Lock, Eye, RefreshCw, Download, X, AlertCircle } from 'lucide-react';
import { BlobProvider } from '@react-pdf/renderer';
import ConfirmModal from '../components/ConfirmModal';
import EstimateDocument, { downloadEstimatePDF } from '../EstimatePDF';
import { useToast } from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import {
  fetchEstimateById,
  createEstimate,
  updateEstimate,
  approveEstimate,
  returnEstimate,
  saveEstimateItemsV2,
  buildSaveItemsPayload,
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
} from '../supabaseEstimates';
import { ITEM_TYPE, ESTIMATE_STATUS, ESTIMATE_STATUS_LABEL } from '../utils/constants';
import {
  saveEstimateDraft,
  loadEstimateDraft,
  clearEstimateDraft,
  formatDraftAge,
} from './estimateDraftV2';
import { addDays, toDateStr } from '../utils/dateUtils';

import PageNav from './PageNav';
import CoverPaper from './CoverPaper';
import SheetPaper, { calcSheetPageCount } from './SheetPaper';
import SettingsPanel from './SettingsPanel';

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

// 新規シートの一時ID（保存時に buildSaveItemsPayload が uuid でない id を null 化 →
// RPC が新規発行 → 戻り値 sheet_ids を index順に本IDへ再マップする）
const newSheetTempId = () => `sheet_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

// 空の明細行テンプレート（sheet_id は呼び出し側で付与）
const newItemRow = (sheetId, sortOrder) => ({
  sheet_id: sheetId,
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

const newCategoryRow = (sheetId, sortOrder) => ({
  sheet_id: sheetId,
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

const MAX_ROWS = 300;

// ============================================================
// メインコンポーネント
// ============================================================
const EstimateEditor = ({ estimateId, onBack, onSaved, onStatusChanged }) => {
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

  // シート state（[{ id, title }]、表示順）
  const [sheets, setSheets] = useState([]);
  // 明細 state（全シート通しのフラットリスト、各行に sheet_id）
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
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewStale, setPreviewStale] = useState(false);

  // 未保存変更の追跡
  const isDirty = useRef(false);
  const isInitialized = useRef(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // 自動退避（localStorage）からの復元プロンプト
  const [pendingDraft, setPendingDraft] = useState(null); // { header, sheets, items, savedAt } | null

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
          // 新規はトップシート1枚を仮ID付きで用意し、初期明細を帰属させる
          const topSheetId = newSheetTempId();
          setSheets([{ id: topSheetId, title: null }]);
          setItems([
            { ...newCategoryRow(topSheetId, 0), category_symbol: 'A', name: '' },
            { ...newItemRow(topSheetId, 1) },
            ...fixedRows.map((r, i) => ({ ...r, sheet_id: topSheetId, sort_order: 100 + i })),
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
          // fetchEstimateById がシート未生成時は仮トップシートを合成、
          // sheet_id NULL 明細はトップシートへ帰属済み
          setSheets((est.sheets || []).map(s => ({ id: s.id, title: s.title ?? null })));
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
  }, [header, sheets, items]);

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
      saveEstimateDraft(estimateId, { header, sheets, items });
    }, 1500);
    return () => clearTimeout(timer);
  }, [header, sheets, items, estimateId, isNew, originalStatus, pendingDraft]);

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
  // シート操作
  // ============================================================
  const handleAddSheet = useCallback(() => {
    setSheets(prev => {
      const nextIndex = prev.length + 1;
      const id = newSheetTempId();
      const newSheet = { id, title: `内訳明細 ${nextIndex - 1}` };
      // 新シートには空のカテゴリ＋明細行を1組用意する
      setItems(items => ([
        ...items,
        { ...newCategoryRow(id, items.length), category_symbol: '', name: '' },
        { ...newItemRow(id, items.length + 1) },
      ]));
      return [...prev, newSheet];
    });
  }, []);

  const handleDeleteSheet = useCallback((sheetIndex) => {
    if (sheetIndex === 0) return; // トップシートは削除不可
    setSheets(prev => {
      const target = prev[sheetIndex];
      if (!target) return prev;
      // 該当シートに属する明細も併せて除去する
      setItems(items => items.filter(it => it.sheet_id !== target.id));
      return prev.filter((_, i) => i !== sheetIndex);
    });
  }, []);

  // ============================================================
  // 過去見積からの取込（トップシートの末尾＝FIXED行の手前へ追記）
  // ============================================================
  const handleImportGroups = useCallback((groups) => {
    const topSheetId = sheets[0]?.id;
    if (!topSheetId) return;
    setItems(prev => {
      // トップシート内の明細を、その他シートの明細と分離して処理する
      const topItems = prev.filter(it => it.sheet_id === topSheetId);
      const otherItems = prev.filter(it => it.sheet_id !== topSheetId);
      const nonFixed = topItems.filter(i => i.item_type !== ITEM_TYPE.FIXED);
      const fixed = topItems.filter(i => i.item_type === ITEM_TYPE.FIXED);
      const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const existingCatCount = nonFixed.filter(i => i.item_type === ITEM_TYPE.CATEGORY).length;

      const imported = [];
      groups.forEach((g, gIdx) => {
        imported.push({
          ...newCategoryRow(topSheetId, 0),
          category_symbol: symbols[existingCatCount + gIdx] || '',
          name: g.category?.name || '',
        });
        g.rows.forEach(row => {
          imported.push({
            ...newItemRow(topSheetId, 0),
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

      // トップシート明細を再構成（sort_orderはシート内連番）し、他シートと結合
      const rebuiltTop = [...nonFixed, ...imported, ...fixed].map((r, i) => ({ ...r, sort_order: i }));
      return [...rebuiltTop, ...otherItems];
    });
    showToast('過去見積から明細を取込みました', 'success');
  }, [sheets, showToast]);

  // ============================================================
  // 合計計算（トップシートの明細＋FIXEDを対象にする。鑑・トップシート表示用）
  // ============================================================
  const totals = useMemo(() => {
    const topSheetId = sheets[0]?.id;
    const topItems = items.filter(it => it.sheet_id === topSheetId);
    const visibleItems = topItems.filter(i =>
      i.item_type === ITEM_TYPE.ITEM ||
      (i.item_type === ITEM_TYPE.FIXED && header.show_fixed_fees)
    );
    return calcTotals(visibleItems, Number(header.tax_rate), {
      type: header.net_calc_type,
      perc: header.net_perc,
      manualAmount: header.net_amount,
    });
  }, [items, sheets, header.show_fixed_fees, header.tax_rate, header.net_calc_type, header.net_perc, header.net_amount]);

  // 各シートの明細を sheet_id で束ねる（描画・保存で共用）
  const itemsBySheet = useMemo(() => {
    const map = new Map(sheets.map(s => [s.id, []]));
    items.forEach(it => {
      if (map.has(it.sheet_id)) map.get(it.sheet_id).push(it);
    });
    return map;
  }, [sheets, items]);

  // 各シート先頭ページの通しページ番号（鑑 = No.1、以降シート順に加算）
  const sheetStartPages = useMemo(() => {
    const starts = [];
    let running = 2; // No.1 は鑑
    sheets.forEach((sheet, idx) => {
      starts.push(running);
      const sheetItems = itemsBySheet.get(sheet.id) || [];
      running += calcSheetPageCount(sheetItems, header, idx === 0, totals);
    });
    return starts;
  }, [sheets, itemsBySheet, header, totals]);

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
  // PDFプレビュー用データ構築（Phase 3 暫定: 全シートの明細をフラット化して
  // 旧 EstimateDocument へ渡す。show_subtotals の小計行はシート単位で注入する）
  // ============================================================
  const buildPreviewEstimate = useCallback(() => {
    const customer = customers.find(c => String(c.id) === String(header.customer_id)) || null;
    const staff    = officeStaff.find(s => String(s.id) === String(header.staff_id))  || null;

    // シート順に明細を連結（COMMENTエンコード・SUBTOTAL除去）
    let pdfItems = [];
    sheets.forEach((sheet) => {
      const sheetItems = (itemsBySheet.get(sheet.id) || [])
        .filter(i => i.item_type !== ITEM_TYPE.SUBTOTAL)
        .map(({ _tempId, ...item }) => {
          if (item.item_type === ITEM_TYPE.COMMENT) {
            return { ...item, item_type: ITEM_TYPE.ITEM, category_symbol: '__comment__' };
          }
          return item;
        });

      // show_subtotals ON の場合は工種ごとの小計行を動的生成（シート内で完結）
      if (header.show_subtotals) {
        const withSubtotals = [];
        let currentCatKey = null;
        let catAmount = 0;
        sheetItems.forEach((item, idx) => {
          if (item.item_type === ITEM_TYPE.CATEGORY) {
            if (currentCatKey !== null) {
              withSubtotals.push({ item_type: ITEM_TYPE.SUBTOTAL, name: '合　計', amount: catAmount, sort_order: withSubtotals.length });
            }
            currentCatKey = item.id || idx;
            catAmount = 0;
          } else if (item.item_type === ITEM_TYPE.ITEM) {
            catAmount += Number(item.amount) || 0;
          }
          withSubtotals.push(item);
        });
        if (currentCatKey !== null) {
          withSubtotals.push({ item_type: ITEM_TYPE.SUBTOTAL, name: '合　計', amount: catAmount, sort_order: withSubtotals.length });
        }
        pdfItems = pdfItems.concat(withSubtotals);
      } else {
        pdfItems = pdfItems.concat(sheetItems);
      }
    });

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
  }, [header, sheets, itemsBySheet, customers, officeStaff, estimateNumber]);

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
  }, [header, sheets, items]);

  // Escape キーでプレビューを閉じる
  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);

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
    // Phase 3の確定判断: カテゴリ必須明細バリデーションは廃止。空行は保持する。

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

      // 保存用明細を組み立てる（シート順に連結、COMMENTエンコード、SUBTOTAL注入）。
      // buildSaveItemsPayload はフィルタせず全行を順序どおり保存するため、
      // 空行の除去や name 空フィルタは行わない（Phase 3: 空行保持）。
      const savingItems = [];
      sheets.forEach((sheet) => {
        let sheetItems = (itemsBySheet.get(sheet.id) || [])
          .filter(i => i.item_type !== ITEM_TYPE.SUBTOTAL)
          .map(({ _tempId, ...i }) => {
            // COMMENT行はDB制約上 item_type:'item' + category_symbol:'__comment__' としてエンコード
            const isComment = i.item_type === ITEM_TYPE.COMMENT;
            return {
              ...i,
              sheet_id: sheet.id,
              item_type:       isComment ? ITEM_TYPE.ITEM : i.item_type,
              category_symbol: isComment ? '__comment__' : i.category_symbol,
            };
          });

        if (header.show_subtotals) {
          const withSubtotals = [];
          let currentCatKey = null;
          let catAmount = 0;
          sheetItems.forEach((item, idx) => {
            if (item.item_type === ITEM_TYPE.CATEGORY) {
              if (currentCatKey !== null) {
                withSubtotals.push({ sheet_id: sheet.id, item_type: ITEM_TYPE.SUBTOTAL, name: '合　計', amount: catAmount });
              }
              currentCatKey = item.id || idx;
              catAmount = 0;
            } else if (item.item_type === ITEM_TYPE.ITEM) {
              catAmount += Number(item.amount) || 0;
            }
            withSubtotals.push(item);
          });
          if (currentCatKey !== null) {
            withSubtotals.push({ sheet_id: sheet.id, item_type: ITEM_TYPE.SUBTOTAL, name: '合　計', amount: catAmount });
          }
          sheetItems = withSubtotals;
        }

        savingItems.push(...sheetItems);
      });

      // 税込合計はトップシートの明細（FIXED含む）から算出（鑑と一致させる）
      const topSheetId = sheets[0]?.id;
      const savingVisibleItems = savingItems.filter(i =>
        i.sheet_id === topSheetId && (
          i.item_type === ITEM_TYPE.ITEM ||
          (i.item_type === ITEM_TYPE.FIXED && header.show_fixed_fees)
        )
      );
      const savingTotals = calcTotals(savingVisibleItems, Number(header.tax_rate), {
        type: header.net_calc_type,
        perc: header.net_perc,
        manualAmount: header.net_amount,
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

      // シート＋明細を v2 RPC で保存（シート順に UPSERT、明細は全削除→再INSERT）
      const { payloadSheets, payloadItems } = buildSaveItemsPayload(sheets, savingItems);
      const savedSheetIds = await saveEstimateItemsV2(savedId, payloadSheets, payloadItems);

      // 返却された sheet_ids を index順に適用し、state の仮ID→本UUID を再マップする
      // （次回保存で既存シートとして扱われるよう、items の sheet_id も更新）
      if (Array.isArray(savedSheetIds) && savedSheetIds.length === sheets.length) {
        const idRemap = new Map();
        const remappedSheets = sheets.map((s, idx) => {
          idRemap.set(s.id, savedSheetIds[idx]);
          return { ...s, id: savedSheetIds[idx] };
        });
        setSheets(remappedSheets);
        setItems(prev => prev.map(it => ({
          ...it,
          sheet_id: idRemap.get(it.sheet_id) ?? it.sheet_id,
        })));
      }

      // 「受注」時の自動連動（Projectsテーブルへのコピー）
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

  // ============================================================
  // 自動退避データの復元／破棄
  // ============================================================
  const handleRestoreDraft = () => {
    if (pendingDraft) {
      setHeader(pendingDraft.header);
      setSheets(pendingDraft.sheets);
      setItems(pendingDraft.items);
      isDirty.current = true;
    }
    setPendingDraft(null);
  };

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
    <div className="flex flex-col h-full min-h-screen bg-slate-100">

      {/* ===== ヘッダーバー ===== */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
        <button
          onClick={() => isDirty.current ? setShowLeaveConfirm(true) : onBack()}
          aria-label="一覧に戻る"
          title="一覧に戻る"
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <FileText size={20} className="text-blue-600" />
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
        <div className="bg-amber-50 border-b border-amber-200 text-amber-700 px-4 py-2.5 text-sm flex items-center gap-2 shrink-0">
          <Lock size={16} />
          この見積書は「{ESTIMATE_STATUS_LABEL[originalStatus] || originalStatus}」のため編集できません。編集するには「下書きに戻す」を実行してください。
        </div>
      )}

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 px-4 py-2.5 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* ===== 本体: 左ナビ / 中央紙面スタック / 右設定パネル ===== */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* 左ナビ */}
        <div className="shrink-0 px-2 bg-white border-r border-slate-200 overflow-y-auto">
          <PageNav
            sheets={sheets}
            items={items}
            onDeleteSheet={handleDeleteSheet}
            onAddSheet={handleAddSheet}
            isLocked={isLocked}
          />
        </div>

        {/* 中央: 紙面スタック（PC専用・横スクロール可） */}
        <div className="flex-1 min-w-0 overflow-auto bg-slate-200 py-8">
          <div className="flex flex-col items-center gap-8 px-6">
            {/* 鑑（表紙） */}
            <CoverPaper
              header={header}
              onChange={handleHeaderChange}
              customers={customers}
              onCreateCustomer={handleCreateCustomer}
              officeStaff={officeStaff}
              settings={settings}
              totals={totals}
              isLocked={isLocked}
            />

            {/* 各明細シート */}
            {sheets.map((sheet, idx) => (
              <SheetPaper
                key={sheet.id ?? idx}
                sheet={sheet}
                sheetIndex={idx}
                items={itemsBySheet.get(sheet.id) || []}
                header={header}
                settings={settings}
                totals={totals}
                startPageNumber={sheetStartPages[idx]}
              />
            ))}

            {/* シート追加（最終シート下） */}
            {!isLocked && (
              <button
                type="button"
                onClick={handleAddSheet}
                className="w-full max-w-[1123px] flex items-center justify-center gap-1.5 py-4 rounded-lg text-sm text-slate-500 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600 hover:bg-white/50 transition-colors"
                title="内訳明細シートを追加"
              >
                ＋ ページ追加
              </button>
            )}
          </div>
        </div>

        {/* 右: 設定パネル */}
        <div className="w-[280px] shrink-0 bg-white border-l border-slate-200 overflow-y-auto p-3">
          <SettingsPanel
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
            numberError={numberError}
            onReissueNumber={handleReissueNumber}
            onImportGroups={handleImportGroups}
            currentEstimateId={estimateId}
            onOpenPreview={handleOpenPreview}
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
                {({ url, loading: pdfLoading, error: pdfError }) => {
                  if (pdfLoading) {
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
    </div>
  );
};

export default EstimateEditor;
