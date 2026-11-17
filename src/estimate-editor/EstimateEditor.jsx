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
//   - 表紙・シート・明細と申請を saveEstimateV3 で一体保存
//   - PDFプレビューは暫定で全シートをフラット化し旧 EstimateDocument に渡す（Phase 6で本対応）
// 明細セル編集は Phase 4、計算・リンクエンジンは Phase 5 で実装する。

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, FileText, Lock, Eye, RefreshCw, Download, X, AlertCircle, Maximize2, Minimize2, History } from 'lucide-react';
import EstimatePdfFrame from '../components/EstimatePdfFrame';
import { estimatePdfFileName } from '../utils/estimatePdfDelivery';
import { BlobProvider } from '@react-pdf/renderer';
import ConfirmModal from '../components/ConfirmModal';
import EstimateDocument, { downloadEstimatePDF } from '../EstimatePDF';
import { useToast } from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import {
  fetchEstimateById,
  updateEstimate,
  approveEstimate,
  returnEstimate,
  saveEstimateV3,
  buildSaveItemsPayload,
  syncEstimateToProject,
  copyEstimateItemsToProjectTasks,
  projectExists,
  fetchCustomers,
  createCustomer,
  fetchWorkers,
  getNextEstimateSeq,
  calcTopSheetTotals,
  formatCurrency,
  checkDuplicateNumber,
  findAvailableBranchNumber,
  fetchOfficeStaff,
  fetchSystemSettings,
  searchEstimateItemSuggestions,
} from '../supabaseEstimates';
import { ITEM_TYPE, ESTIMATE_STATUS, ESTIMATE_STATUS_LABEL, isAdminRole } from '../utils/constants';
import {
  saveEstimateDraft,
  loadEstimateDraft,
  clearEstimateDraft,
  formatDraftAge,
  saveLastSavedSnapshot,
  loadLastSavedSnapshot,
} from './estimateDraftV2';
import { addDays, toDateStr } from '../utils/dateUtils';

import PageNav from './PageNav';
import CoverPaper from './CoverPaper';
import SheetPaper, { calcSheetPageCount } from './SheetPaper';
import SettingsPanel from './SettingsPanel';
import { useEditHistory } from './useEditHistory';
import { SERVER_MANAGED_HEADER_FIELDS } from './editHistory';
import {
  orderedSelection,
  rangeUids,
  removeRows,
  duplicateRows,
  moveRows,
  moveRowsTo,
  buildRowsClipboard,
  parseRowsClipboard,
  rowsFromTsv,
  pasteRowsInto,
  parseTsvCells,
  tsvNumber,
} from './rowBulkOps';
import { computeEstimateCalc, wouldCreateCycle, computeAutoAmount, encodeSheetItemsForOutput } from './estimateCalc';

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

// 明細行のクライアント側安定キー。SheetPaper のセル編集ハンドラは配列 index ではなく
// この _uid で対象行を特定する（描画上のシート内 index と state のフラット index が
// ずれても正しい行を更新できるようにするため）。保存時は buildSaveItemsPayload/
// buildPreviewEstimate が _tempId と共に取り除く（DBには送らない）。
let _uidCounter = 0;
const newUid = () => `row_${Date.now()}_${_uidCounter++}_${Math.random().toString(36).slice(2, 7)}`;

// 空の明細行テンプレート（sheet_id は呼び出し側で付与）
const newItemRow = (sheetId, sortOrder) => ({
  _uid: newUid(),
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

const newCommentRow = (sheetId, sortOrder) => ({
  _uid: newUid(),
  sheet_id: sheetId,
  item_type: ITEM_TYPE.COMMENT,
  category_symbol: null,
  name: '',
  spec: null,
  quantity: null,
  unit: null,
  unit_price: null,
  amount: null,
  note: null,
  sort_order: sortOrder,
});

const newCategoryRow = (sheetId, sortOrder) => ({
  _uid: newUid(),
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

// 工種(グループ)行の記号候補。既存の工種行の数から次の記号を決める（A, B, C, ...）。
const CATEGORY_SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nextCategorySymbol = (items) => {
  const count = items.filter(i => i.item_type === ITEM_TYPE.CATEGORY).length;
  return CATEGORY_SYMBOLS[count] || '';
};

const MAX_ROWS = 300;

// 複数行の複製・貼り付けで新しい行に振るID
const ROW_IDS = {
  uid: () => newUid(),
  catTempId: () => `cat_${Date.now()}_${Math.random()}`,
};
// このタブで直前にコピーした行（クリップボードの html が落ちても行の種類・リンクを復元するため）
let lastRowsCopy = null;
// 入力欄（文字入力・選択欄）か。行選択中のキー操作・コピー＆貼り付けを入力欄では横取りしない
const isEditableEl = (el) =>
  !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
// モーダル・通知など、紙面より手前の重ね画面の中か（全画面シート表示は紙面扱い）
const isInOverlay = (el) => {
  if (!(el instanceof HTMLElement)) return false;
  const layer = el.closest('.fixed');
  return !!layer && !layer.hasAttribute('data-estimate-undo-scope');
};

// 文字を打ち込む入力欄か（同じ欄への連続入力を1回分にまとめる判定に使う。select・日付・チェックは対象外）
const TYPING_INPUT_TYPES = new Set(['', 'text', 'search', 'number', 'tel', 'email', 'url']);
const isTypingTarget = (el) =>
  !!el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && TYPING_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase())));

// 新規見積の支払条件の初期値（既存見積の保存値の復元には使わない。null/欠損時のみ補完）
const DEFAULT_PAYMENT_TERMS = '従来通り';

// ============================================================
// メインコンポーネント
// ============================================================
const EstimateEditor = ({ estimateId: documentId, onBack, onSaved, onStatusChanged }) => {
  const [estimateId, setEstimateId] = useState(documentId);
  const operationInFlight = useRef(false);
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
    payment_terms: DEFAULT_PAYMENT_TERMS,
    notes: '',
    tax_rate: 0.10,
    status: ESTIMATE_STATUS.DRAFT,
    show_net: false,
    show_subtotals: false,
    stamp_header: 'company',
    show_approver: true,
    show_reform_logo: false,
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
  // 編集ロック判定（handleGenerateSummary やdirty追跡effect等が isLocked を参照するため、それらより前で確定させる）
  const isLocked = originalStatus !== ESTIMATE_STATUS.DRAFT;
  const inputsLocked = isLocked || saving;

  // プレビュー state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewStale, setPreviewStale] = useState(false);

  // 明細シート全画面表示（サイドバーの制約を受けずに1シートのみ表示）
  const [fullscreenSheetIndex, setFullscreenSheetIndex] = useState(null);

  // 未保存変更の追跡
  const isDirty = useRef(false);
  const isInitialized = useRef(false);
  // 初期化直後、dirty追跡effectが1回だけ「読み込み結果の反映」を検知してしまう
  // （setHeader/setSheets/setItems による初期値セットが header/sheets/items の変化として
  // カウントされるため）ので、その最初の1回分だけスキップするためのフラグ。
  const skipNextDirtyCheck = useRef(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // 自動退避（localStorage）からの復元プロンプト
  const [pendingDraft, setPendingDraft] = useState(null); // { header, sheets, items, savedAt } | null
  // この端末への自動退避が最後に行われた日時（UIインジケーター表示用。サーバー保存とは別物）
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  // 保存後に誤って明細を上書き・削除した場合の救済用「直前の保存内容に戻す」確認モーダル
  const [showRestoreLastSaved, setShowRestoreLastSaved] = useState(false);

  // ============================================================
  // 元に戻す／やり直し（鑑・シート・明細をまとめて履歴化）
  // 各編集ハンドラは history.edit(操作名, {key, focus}, producer) で状態を変える。
  // producer は現在の { header, sheets, items } から変更後の部分状態を返す（変化なしは null）。
  // ============================================================
  const history = useEditHistory(
    { header, sheets, items },
    { setHeader, setSheets, setItems },
    newSheetTempId,
  );
  // 通知のボタンなど、後から呼ばれる処理が「その時点の」ロック状態を見るための ref
  const inputsLockedRef = useRef(inputsLocked);
  inputsLockedRef.current = inputsLocked;
  const canEditNow = () => !inputsLockedRef.current && !operationInFlight.current;

  // 戻した箇所のセルへカーソルを移す（描画反映後に実行）
  const focusHistoryTarget = useCallback((entry) => {
    requestAnimationFrame(() => {
      const f = entry?.focus;
      if (!f?.uid) return;
      // 全画面表示中は背面の紙面にも同じセルがあるため、全画面側を優先して探す
      const root = document.querySelector('[data-estimate-fullscreen]') || document;
      const esc = (s) => (window.CSS?.escape ? window.CSS.escape(s) : s);
      const el = root.querySelector(`[data-uid="${esc(f.uid)}"][data-col="${esc(f.col || 'name')}"]`)
        || root.querySelector(`[data-uid="${esc(f.uid)}"]`);
      if (!el) return;
      // フォーカス中の数値セルは編集用の下書き値を持つため、一度外して最新値で表示し直す
      const active = document.activeElement;
      if (active && active !== document.body) active.blur();
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (!canEditNow()) return;
    const entry = history.undo();
    if (entry) focusHistoryTarget(entry);
  }, [history.undo, focusHistoryTarget]);

  const handleRedo = useCallback(() => {
    if (!canEditNow()) return;
    const entry = history.redo();
    if (entry) focusHistoryTarget(entry);
  }, [history.redo, focusHistoryTarget]);

  // 大きい操作（行・シート削除、総括表生成、貼り付け、取込）の後に「元に戻す」付きの通知を出す。
  // entry は history.edit の戻り値（変化がなかった操作では null になり、通知も出ない）。
  const notifyWithUndo = useCallback((entry, message) => {
    if (!entry) return;
    showToast(message, 'success', {
      action: {
        label: '元に戻す',
        onClick: () => {
          if (!canEditNow()) {
            showToast('編集できない状態のため元に戻せません', 'info');
            return;
          }
          const undone = history.undoIfTop(entry.id);
          if (undone) focusHistoryTarget(undone);
          else showToast('この後に別の操作をしているため、右パネルの「元に戻す」から順に戻してください', 'info');
        },
      },
    });
  }, [showToast, history.undoIfTop, focusHistoryTarget]);

  // 明細だけを変える操作用の薄いラッパー。fn は現在の明細から次の明細を返す（同じ配列なら変化なし）
  const editItems = useCallback((label, opts, fn) =>
    history.edit(label, opts, (st) => {
      const next = fn(st.items, st);
      return !next || next === st.items ? null : { items: next };
    }), [history.edit]);

  // Ctrl+Z（元に戻す）/ Ctrl+Y・Ctrl+Shift+Z（やり直し）。
  // 紙面（data-estimate-undo-scope 内）の入力欄ではブラウザ標準の入力Undoを止めてアプリの履歴を使う。
  // それ以外の入力欄はブラウザ標準のまま。モーダル表示中は見積本体を戻さない。
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.isComposing || e.keyCode === 229) return;
      const k = e.key.toLowerCase();
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;
      if (previewOpen || inputsLocked) return;
      const t = e.target instanceof HTMLElement ? e.target : document.body;
      // モーダル（role=dialog / 全面固定表示の重ね画面）の中、またはモーダルが開いている間は対象外。
      // 全画面シート表示は data-estimate-undo-scope 付きの固定表示なので対象に含める。
      if (document.querySelector('[aria-modal="true"]') || isInOverlay(t)) return;
      if (isEditableEl(t) && !t.closest('[data-estimate-undo-scope]')) return;
      e.preventDefault();
      if (isUndo) handleUndo(); else handleRedo();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [previewOpen, inputsLocked, handleUndo, handleRedo]);

  // 別の入力欄へ移ったら、同じセルへの連続入力のまとめを打ち切る
  // セルへの入力を始めたら行の選択は解除する（解除関数は下の「複数行の一括操作」で設定）
  const clearRowSelectionRef = useRef(null);
  useEffect(() => {
    const onFocusIn = (e) => {
      history.breakCoalesce();
      if (isEditableEl(e.target)) clearRowSelectionRef.current?.();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [history.breakCoalesce]);

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

        setEstimateId(documentId);
        if (!documentId) {
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
          history.setKnownSheetIds([]);
          setSheets([{ id: topSheetId, title: null }]);
          setItems([
            { ...newCategoryRow(topSheetId, 0), category_symbol: 'A', name: '' },
            { ...newItemRow(topSheetId, 1) },
          ]);
        } else {
          const est = await fetchEstimateById(documentId);
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
            // 保存済みの空文字は意図的な空欄として維持する。null/undefined（型上は非null列のため
            // 旧データ・欠損のみ）は新規時の既定値と同じ意味の「従来通り」として扱う。
            payment_terms:  est.payment_terms ?? DEFAULT_PAYMENT_TERMS,
            notes:          est.notes || '',
            tax_rate:       est.tax_rate ?? 0.10,
            status:         est.status || ESTIMATE_STATUS.DRAFT,
            show_net:        est.show_net ?? false,
            show_subtotals:  est.show_subtotals ?? false,
            stamp_header:    est.stamp_header || 'company',
            show_approver:   true,
            show_reform_logo: est.show_reform_logo ?? false,
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
          history.setKnownSheetIds((est.sheets || []).map(s => s.id));
          setSheets((est.sheets || []).map(s => ({ id: s.id, title: s.title ?? null })));
          // DBで '__comment__' としてエンコードされたコメント行を復元。
          // 併せて全行にクライアント側安定キー _uid を付与する（セル編集の対象特定用）。
          const loadedItems = (est.items || []).map(item => {
            const base = item.item_type === ITEM_TYPE.ITEM && item.category_symbol === '__comment__'
              ? { ...item, item_type: ITEM_TYPE.COMMENT, category_symbol: null }
              : { ...item };
            return { ...base, _uid: newUid() };
          });
          setItems(loadedItems);
          setOriginalStatus(est.status || ESTIMATE_STATUS.DRAFT);
        }

        // 前回の未保存入力が退避されていれば復元を提案する。
        history.clear();
        const draft = loadEstimateDraft(documentId);
        if (draft) {
          setPendingDraft(draft);
        }
      } catch (e) {
        setError('データの読み込みに失敗しました: ' + e.message);
      } finally {
        setLoading(false);
        isInitialized.current = true;
        // このあと header/sheets/items の初期値セットが反映されたレンダーで
        // dirty追跡effectが1回発火するが、それはユーザーの変更ではないのでスキップする。
        skipNextDirtyCheck.current = true;
      }
    };
    init();
  }, [documentId]);

  useEffect(() => {
    if (!isInitialized.current) return;
    if (skipNextDirtyCheck.current) {
      skipNextDirtyCheck.current = false;
      return;
    }
    // ロック中（下書き以外）は編集操作自体が行えないため、
    // ステータスバッジ操作等による header の再セットを「未保存の変更」として扱わない。
    if (isLocked) return;
    isDirty.current = true;
  }, [header, sheets, items, isLocked]);

  // 入力内容を localStorage へ自動退避（debounce 1.5秒）。
  // ・初期化前は退避しない（読み込み直後のDB値で上書きしない）
  // ・復元プロンプト表示中は退避しない（ユーザー判断前に退避を上書きしない）
  // ・ロック中（下書き以外）は編集不可のため退避不要
  useEffect(() => {
    if (!isInitialized.current) return;
    if (pendingDraft) return;
    if (isLocked || saving) return;
    if (!isDirty.current) return;

    const timer = setTimeout(() => {
      saveEstimateDraft(estimateId, { header, sheets, items });
      setLastDraftSavedAt(Date.now());
    }, 1500);
    return () => clearTimeout(timer);
  }, [header, sheets, items, estimateId, isLocked, saving, pendingDraft]);

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
    if (inputsLocked || operationInFlight.current) return;
    // 文字を打ち込む欄は同じ欄への連続入力を1回分にまとめる（選択欄・切替は毎回1回分）
    const key = isTypingTarget(document.activeElement) ? `header:${field}` : null;
    history.edit('鑑の入力', { key }, ({ header: h }) =>
      (h[field] === value ? null : { header: { ...h, [field]: value } }));
  }, [inputsLocked, history.edit]);

  // 顧客ドロップダウンからの新規顧客登録（登録後は自動選択する）
  const handleCreateCustomer = useCallback(async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    try {
      const created = await createCustomer(trimmed);
      setCustomers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'ja')));
      history.edit('顧客の選択', {}, ({ header: h }) => ({ header: { ...h, customer_id: created.id } }));
      showToast('新規顧客を登録しました', 'success');
      return created;
    } catch (e) {
      showToast('顧客の登録に失敗しました: ' + e.message, 'error');
      return null;
    }
  }, [showToast, history.edit]);

  // ステータス変更系の操作は、画面遷移で失われないようその場でSupabaseへ反映する
  const persistStatus = useCallback(async (patch) => {
    if (operationInFlight.current || !estimateId) return false;
    operationInFlight.current = true;
    try {
      setSaving(true);
      const saved = await updateEstimate(estimateId, patch);
      setHeader(h => ({ ...h, ...saved }));
      setOriginalStatus(saved.status);

      // 「受注」への遷移時はProjectsテーブルへ連携する（handleSave経由の保存を通らない
      // ステータスバッジ操作のため、ここでも同じ連携処理を行う必要がある）
      if (patch.status === ESTIMATE_STATUS.ORDERED &&
          (originalStatus !== ESTIMATE_STATUS.ORDERED || !header.project_id)) {
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
          // 工種へは「実際の作業明細」だけを渡す。リンク解決済みの値を使い、
          // 別シート合計・カテゴリ合計を参照するリンク行（総括表の行）は除く。
          // 生の items のままだと、総括表のリンク行と子シートの明細が二重に工種化され、
          // リンク行の金額も未解決（0円や古い値）のまま入ってしまう。
          const { resolvedItems: resolvedForTasks } = computeEstimateCalc(sheets, items);
          const workItems = resolvedForTasks.filter(it => !it.linked_sheet_id && !it.linked_category_item_id);
          await copyEstimateItemsToProjectTasks(linkedProjectId, workItems);
        } catch (syncErr) {
          console.error('工事マスタへの連携に失敗しました:', syncErr);
          showToast(
            'ステータスは更新しましたが、工事案件への連携に失敗しました。工事一覧から手動で登録してください。',
            'error'
          );
        }
      }

      onStatusChanged?.();
      return true;
    } catch (e) {
      setError('ステータスの変更に失敗しました: ' + e.message);
      showToast('ステータスの変更に失敗しました: ' + e.message, 'error');
      return false;
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  }, [estimateId, onStatusChanged, header.project_id, header.title, header.customer_id, originalStatus, showToast, items, sheets]);

  // 承認・差し戻し（SECURITY DEFINER RPC経由。証跡カラムはDB側で記録される）
  const handleApprove = useCallback(async () => {
    if (operationInFlight.current || !estimateId) return false;
    operationInFlight.current = true;
    try {
      setSaving(true);
      const trail = await approveEstimate(estimateId);
      setHeader(h => ({ ...h, ...trail }));
      setOriginalStatus(trail.status);
      onStatusChanged?.();
      return true;
    } catch (e) {
      setError('承認に失敗しました: ' + e.message);
      showToast('承認に失敗しました: ' + e.message, 'error');
      return false;
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  }, [estimateId, onStatusChanged, showToast]);

  const handleReturn = useCallback(async (reason) => {
    if (operationInFlight.current || !estimateId) return false;
    operationInFlight.current = true;
    try {
      setSaving(true);
      const trail = await returnEstimate(estimateId, reason);
      setHeader(h => ({ ...h, ...trail }));
      setOriginalStatus(trail.status);
      onStatusChanged?.();
      return true;
    } catch (e) {
      setError('差し戻しに失敗しました: ' + e.message);
      showToast('差し戻しに失敗しました: ' + e.message, 'error');
      return false;
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  }, [estimateId, onStatusChanged, showToast]);

  const handleSubmit = (approverStaffId) => saveCurrentEstimate(approverStaffId);
  const handleSubmitToCustomer = () => persistStatus({ status: ESTIMATE_STATUS.SUBMITTED });
  const handleOrder = () => persistStatus({ status: ESTIMATE_STATUS.ORDERED, lost_reason: '' });
  const handleLose = (reason) => persistStatus({ status: ESTIMATE_STATUS.LOST, lost_reason: reason });

  // 担当者(staff_id)未設定の見積書は作成者チェック対象外とし、誰でも編集可能とする
  const isCreator = isAdminRole(currentStaff?.role) || !header.staff_id || String(header.staff_id) === String(currentStaff?.id);
  const creatorStaff = officeStaff.find(s => String(s.id) === String(header.staff_id)) || null;

  // ============================================================
  // シート操作
  // ============================================================
  const handleAddSheet = useCallback(() => {
    if (operationInFlight.current) return;
    history.edit('シートの追加', {}, ({ sheets: prev, items: prevItems }) => {
      const id = newSheetTempId();
      // 新シートには空のカテゴリ＋明細行を1組用意する
      return {
        sheets: [...prev, { id, title: `内訳明細 ${prev.length}` }],
        items: [
          ...prevItems,
          { ...newCategoryRow(id, prevItems.length), category_symbol: '', name: '' },
          { ...newItemRow(id, prevItems.length + 1) },
        ],
      };
    });
  }, [history.edit]);

  const handleDeleteSheet = useCallback((sheetIndex) => {
    if (operationInFlight.current) return;
    const entry = history.edit('シートの削除', {}, ({ sheets: prev, items: prevItems }) => {
      const target = prev[sheetIndex];
      if (!target) return null;
      // トップシート（index 0）は「総括表」の場合のみ削除可（PageNav側でも制御）
      if (sheetIndex === 0 && target.title !== SUMMARY_TITLE) return null;
      // 該当シートに属する明細も併せて除去する
      return {
        sheets: prev.filter((_, i) => i !== sheetIndex),
        items: prevItems.filter(it => it.sheet_id !== target.id),
      };
    });
    notifyWithUndo(entry, 'シートを削除しました');
  }, [history.edit, notifyWithUndo]);

  // ============================================================
  // 過去見積からの取込（トップシートの末尾へ追記）
  // ============================================================
  const handleImportGroups = useCallback((groups) => {
    if (operationInFlight.current) return;
    const topSheetId = sheets[0]?.id;
    if (!topSheetId) return;
    const entry = editItems('明細の取込', {}, (prev) => {
      // トップシート内の明細を、その他シートの明細と分離して処理する
      const topItems = prev.filter(it => it.sheet_id === topSheetId);
      const otherItems = prev.filter(it => it.sheet_id !== topSheetId);
      const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const existingCatCount = topItems.filter(i => i.item_type === ITEM_TYPE.CATEGORY).length;

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
      const rebuiltTop = [...topItems, ...imported].map((r, i) => ({ ...r, sort_order: i }));
      return [...rebuiltTop, ...otherItems];
    });
    notifyWithUndo(entry, '過去見積から明細を取込みました');
  }, [sheets, editItems, notifyWithUndo]);

  // ============================================================
  // 総括表自動生成（design.md §4/§5・②水沢中 P2形式）
  // 明細シートのカテゴリ一覧から、各カテゴリ小計を②リンクで引く「総括表」シートを
  // トップシート（index 0）としてワンクリック生成する。リンクは各カテゴリの _uid で
  // 張る（computeEstimateCalc / buildSaveItemsPayload が _uid 参照を解決する）。
  // 既に総括表があれば作り直す（重複生成を防止）。
  // ============================================================
  const SUMMARY_TITLE = '総括表';

  const handleGenerateSummary = useCallback(() => {
    if (operationInFlight.current) return;
    if (isLocked) return;
    const entry = history.edit('総括表の生成', {}, ({ sheets: prevSheets, items: prevItems }) => {
      // 既存の総括表シートは一旦除外し、明細シートだけを対象にする
      const summaryIds = new Set(
        prevSheets.filter(s => s.title === SUMMARY_TITLE).map(s => s.id)
      );
      const detailSheets = prevSheets.filter(s => !summaryIds.has(s.id));
      if (detailSheets.length === 0) return null;

      // 総括表以外（＝明細）の行だけ残す。旧総括表の行は破棄する。
      const detailItems = prevItems.filter(it => !summaryIds.has(it.sheet_id));

      // 明細シートに現れるカテゴリを表示順に収集（空カテゴリも1行として立てる）
      const cats = [];
      for (const s of detailSheets) {
        detailItems
          .filter(it => it.sheet_id === s.id && it.item_type === ITEM_TYPE.CATEGORY)
          .forEach(cat => cats.push(cat));
      }
      if (cats.length === 0) return null; // カテゴリが無ければ生成しない

      const summaryId = newSheetTempId();
      // 総括表の②リンク行: 各カテゴリ小計を数量1.0式・単価・名称で引く
      let order = 0;
      const summaryRows = cats.map(cat => ({
        ...newItemRow(summaryId, order++),
        name: cat.name || '',
        quantity: 1,
        unit: '式',
        // リンク行の実値（単価・金額・名称）は computeEstimateCalc が上書きする
        linked_category_item_id: cat._uid,
      }));

      // 総括表を先頭（トップシート）に据える
      return {
        sheets: [{ id: summaryId, title: SUMMARY_TITLE }, ...detailSheets],
        items: [...summaryRows, ...detailItems],
      };
    });
    if (entry) notifyWithUndo(entry, '総括表を生成しました');
    else showToast('総括表にまとめる工種（カテゴリ）行がありません', 'info');
  }, [isLocked, showToast, history.edit, notifyWithUndo]);

  // ============================================================
  // 明細セル編集・行操作（SheetPaper から _uid で対象行を指定）
  // ============================================================

  // 指定シートの明細だけを sort_order 昇順で連番に振り直すユーティリティ。
  // フラット配列内で該当シートの行順序を正規化しつつ、他シートの行はそのまま維持する。
  const renumberSheet = useCallback((flat, sheetId) => {
    let n = 0;
    return flat.map(it =>
      it.sheet_id === sheetId ? { ...it, sort_order: n++ } : it
    );
  }, []);

  // 金額の自動計算（数量×単価。どちらか空なら amount は据え置き＝手入力を尊重）
  const withAutoAmount = useCallback((row, field, value) => {
    if (field !== 'quantity' && field !== 'unit_price') return { ...row, [field]: value };
    return computeAutoAmount({ ...row, [field]: value });
  }, []);

  // セル値の更新（1フィールド）
  const updateItem = useCallback((uid, field, value) => {
    if (operationInFlight.current) return;
    editItems('セルの入力', { key: `cell:${uid}:${field}`, focus: { uid, col: field } }, (prev) =>
      prev.map(it => (it._uid === uid ? withAutoAmount(it, field, value) : it)));
  }, [withAutoAmount, editItems]);

  // 指定行の直後に新しい明細行を挿入して返す（同一シート内）
  const addRowAfter = useCallback((uid, kind = ITEM_TYPE.ITEM) => {
    if (operationInFlight.current) return;
    editItems('行の追加', { focus: { uid, col: 'name' } }, (prev) => {
      const idx = prev.findIndex(it => it._uid === uid);
      if (idx < 0) return prev;
      const anchor = prev[idx];
      const sheetId = anchor.sheet_id;
      const factory =
        kind === ITEM_TYPE.CATEGORY ? newCategoryRow
        : kind === ITEM_TYPE.COMMENT ? newCommentRow
        : newItemRow;
      const row = factory(sheetId, 0);
      if (kind === ITEM_TYPE.CATEGORY) row.category_symbol = nextCategorySymbol(prev);
      const next = [...prev.slice(0, idx + 1), row, ...prev.slice(idx + 1)];
      return renumberSheet(next, sheetId);
    });
  }, [renumberSheet, editItems]);

  // 指定シート末尾へ新規行を追加
  const addRowToSheet = useCallback((sheetId, kind = ITEM_TYPE.ITEM) => {
    if (operationInFlight.current) return;
    editItems('行の追加', {}, (prev) => {
      const factory =
        kind === ITEM_TYPE.CATEGORY ? newCategoryRow
        : kind === ITEM_TYPE.COMMENT ? newCommentRow
        : newItemRow;
      const row = factory(sheetId, 0);
      if (kind === ITEM_TYPE.CATEGORY) row.category_symbol = nextCategorySymbol(prev);
      const sheetIdxs = prev
        .map((it, i) => ({ it, i }))
        .filter(x => x.it.sheet_id === sheetId);
      const lastOfSheet = sheetIdxs.length ? sheetIdxs[sheetIdxs.length - 1].i : prev.length - 1;
      const next = [...prev.slice(0, lastOfSheet + 1), row, ...prev.slice(lastOfSheet + 1)];
      return renumberSheet(next, sheetId);
    });
  }, [renumberSheet, editItems]);

  // 行削除（シート内の最後の1行は削除しない＝空シート化を防ぐ）
  const removeRow = useCallback((uid) => {
    if (operationInFlight.current) return;
    const entry = editItems('行の削除', { focus: { uid, col: 'name' } }, (prev) => {
      const target = prev.find(it => it._uid === uid);
      if (!target) return prev;
      const sheetId = target.sheet_id;
      const itemsInSheet = prev.filter(it => it.sheet_id === sheetId);
      if (itemsInSheet.length <= 1) return prev; // 最後の1行は残す
      const next = prev.filter(it => it._uid !== uid);
      return renumberSheet(next, sheetId);
    });
    notifyWithUndo(entry, '行を削除しました');
  }, [renumberSheet, editItems, notifyWithUndo]);

  // 行の複製（直後に同内容の行を挿入。_uid/_tempId/id は新規採番）
  const duplicateRow = useCallback((uid) => {
    if (operationInFlight.current) return;
    editItems('行の複製', { focus: { uid, col: 'name' } }, (prev) => {
      const idx = prev.findIndex(it => it._uid === uid);
      if (idx < 0) return prev;
      const src = prev[idx];
      const { id, _tempId, ...rest } = src;
      const copy = {
        ...rest,
        _uid: newUid(),
        ...(src.item_type === ITEM_TYPE.CATEGORY ? { _tempId: `cat_${Date.now()}_${Math.random()}` } : {}),
      };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      return renumberSheet(next, src.sheet_id);
    });
  }, [renumberSheet, editItems]);

  // 行の上下移動（同一シート内でのみ入れ替え）
  const moveRow = useCallback((uid, dir) => {
    if (operationInFlight.current) return;
    editItems('行の移動', { focus: { uid, col: 'name' } }, (prev) => {
      const idx = prev.findIndex(it => it._uid === uid);
      if (idx < 0) return prev;
      const sheetId = prev[idx].sheet_id;
      // 同一シート内の隣接行を探して入れ替える
      const step = dir === 'up' ? -1 : 1;
      let j = idx + step;
      while (j >= 0 && j < prev.length && prev[j].sheet_id !== sheetId) j += step;
      if (j < 0 || j >= prev.length || prev[j].sheet_id !== sheetId) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return renumberSheet(next, sheetId);
    });
  }, [renumberSheet, editItems]);

  // TSV貼り付け（Excelからの複数セル貼り付け）。基準行 uid から、行×列で
  // name/spec/quantity/unit/unit_price/note を流し込み、行が足りなければ追加する。
  const pasteTsv = useCallback((uid, tsv) => {
    if (operationInFlight.current) return;
    const COLS = ['name', 'spec', 'quantity', 'unit', 'unit_price', 'note'];
    const rows = parseTsvCells(tsv);
    if (rows.length === 0) return;

    const entry = editItems('貼り付け', { focus: { uid, col: 'name' } }, (prev) => {
      const anchorIdx = prev.findIndex(it => it._uid === uid);
      if (anchorIdx < 0) return prev;
      const sheetId = prev[anchorIdx].sheet_id;

      // 貼り付け対象となる連続した ITEM 行（アンカー以降・同一シート）を収集
      const applyToRow = (row, cells) => {
        let next = { ...row };
        COLS.forEach((col, ci) => {
          if (ci >= cells.length) return;
          const v = cells[ci];
          next[col] = (col === 'quantity' || col === 'unit_price') ? tsvNumber(v) : v;
        });
        return computeAutoAmount(next);
      };

      const result = [...prev];
      let cursor = anchorIdx;
      for (let r = 0; r < rows.length; r++) {
        // 現在のカーソル位置が同一シートの編集可能行(ITEM)でなければ、新規行を挿入する
        if (
          cursor >= result.length ||
          result[cursor].sheet_id !== sheetId ||
          result[cursor].item_type !== ITEM_TYPE.ITEM
        ) {
          const inserted = newItemRow(sheetId, 0);
          result.splice(cursor, 0, inserted);
        }
        result[cursor] = applyToRow(result[cursor], rows[r]);
        cursor += 1;
      }
      return renumberSheet(result, sheetId);
    });
    notifyWithUndo(entry, '貼り付けました');
  }, [renumberSheet, editItems, notifyWithUndo]);

  // 行にリンクを張る／外す（design.md §4）。
  //   kind='sheet'    : ①別シート合計リンク（targetRef = シートid）
  //   kind='category' : ②カテゴリ小計リンク（targetRef = カテゴリの id/_uid/_tempId）
  //   kind=null       : リンク解除
  // リンク作成前に wouldCreateCycle で到達可能性を検査し、循環になる場合は拒否する。
  const setRowLink = useCallback((uid, kind, targetRef) => {
    if (operationInFlight.current) return;
    editItems(kind ? 'リンクの設定' : 'リンクの解除', { focus: { uid, col: 'name' } }, (prev) => {
      const row = prev.find(it => it._uid === uid);
      if (!row) return prev;
      if (kind && targetRef != null && wouldCreateCycle(sheets, prev, row, kind, targetRef)) {
        showToast('循環参照になるためリンクできません', 'error');
        return prev;
      }
      return prev.map(it => {
        if (it._uid !== uid) return it;
        if (kind === 'sheet') {
          return { ...it, linked_sheet_id: targetRef, linked_category_item_id: null };
        }
        if (kind === 'category') {
          return { ...it, linked_category_item_id: targetRef, linked_sheet_id: null };
        }
        // 解除
        return { ...it, linked_sheet_id: null, linked_category_item_id: null };
      });
    });
  }, [sheets, showToast, editItems]);

  // ============================================================
  // 計算・リンクエンジン（Phase 5: design.md §4/§5）
  // シートをまたぐリンク①②を解決し、実効値・各シート合計・カテゴリ小計を一括計算。
  // 以降の totals（鑑）・itemsBySheet（描画）・ページ数計算はこの解決結果を基準にする。
  // ============================================================
  const calc = useMemo(
    () => computeEstimateCalc(sheets, items),
    [sheets, items]
  );
  const { resolvedItems, sheetTotals, catTotals, cycleUids } = calc;

  // ============================================================
  // 合計計算（トップシートの明細を対象にする。鑑・トップシート表示用）
  // リンク解決後の resolvedItems を基準にすることで、リンク①②の実値が鑑へ反映される。
  // ============================================================
  const totals = useMemo(() => {
    const topSheetId = sheets[0]?.id;
    const topItems = resolvedItems.filter(it => it.sheet_id === topSheetId);
    return calcTopSheetTotals(topItems, header);
  }, [resolvedItems, sheets, header.tax_rate, header.net_calc_type, header.net_perc, header.net_amount]);

  // 各シートの明細を sheet_id で束ねる（描画・保存で共用）。
  // 描画はリンク解決済みの resolvedItems を使う（編集・保存は生の items を使い続ける）。
  const itemsBySheet = useMemo(() => {
    const map = new Map(sheets.map(s => [s.id, []]));
    resolvedItems.forEach(it => {
      if (map.has(it.sheet_id)) map.get(it.sheet_id).push(it);
    });
    return map;
  }, [sheets, resolvedItems]);

  // リンク作成UI（SheetPaper の行リンクピッカー）が選択肢として提示する対象一覧。
  //   sheetTargets    : ①別シート合計リンクの候補（各シートの解決済み合計）
  //   categoryTargets : ②カテゴリ小計リンクの候補（各カテゴリの解決済み小計）
  // ref は setRowLink / computeEstimateCalc が解決に使うキー（id ?? _tempId ?? _uid）と一致させる。
  const catRef = (cat) => String(cat.id ?? cat._tempId ?? cat._uid);
  const linkTargets = useMemo(() => {
    const sheetTargets = sheets.map(s => ({
      id: s.id,
      title: s.title || '（無題シート）',
      total: sheetTotals.get(s.id) ?? 0,
    }));
    const categoryTargets = [];
    sheets.forEach(s => {
      resolvedItems
        .filter(it => it.sheet_id === s.id && it.item_type === ITEM_TYPE.CATEGORY)
        .forEach(cat => {
          const ref = catRef(cat);
          categoryTargets.push({
            ref,
            label: `${cat.category_symbol ? cat.category_symbol + ' ' : ''}${cat.name || '（無題工種）'}`,
            sheetTitle: s.title || '',
            subtotal: catTotals.get(ref) ?? 0,
          });
        });
    });
    return { sheetTargets, categoryTargets };
  }, [sheets, resolvedItems, sheetTotals, catTotals]);

  // 他シートの合計を参照している sheet_id 一覧（①別シート合計リンクの参照先）
  const linkedSheetIds = useMemo(() => {
    const ids = new Set();
    items.forEach(it => {
      if (it.linked_sheet_id) ids.add(it.linked_sheet_id);
    });
    return ids;
  }, [items]);

  // サブシートの「合計」行を表示するか：他シートから参照されているか、末尾シートなら表示
  const shouldShowTotalRow = (sheet, idx) =>
    idx === 0 || linkedSheetIds.has(sheet.id) || idx === sheets.length - 1;

  // 各シート先頭ページの通しページ番号（鑑 = No.1、以降シート順に加算）
  const sheetStartPages = useMemo(() => {
    const starts = [];
    let running = 2; // No.1 は鑑
    sheets.forEach((sheet, idx) => {
      starts.push(running);
      const sheetItems = itemsBySheet.get(sheet.id) || [];
      running += calcSheetPageCount(
        sheetItems, header, idx === 0, totals,
        sheetTotals.get(sheet.id), shouldShowTotalRow(sheet, idx)
      );
    });
    return starts;
  }, [sheets, itemsBySheet, header, totals, sheetTotals, linkedSheetIds]);

  // ============================================================
  // 複数行の一括操作（1シート内で行単位に選択 → 削除・複製・コピー／切り取り／貼り付け・上下移動）
  // 選択は _uid で持ち、元に戻すなどで消えた行は表示時に自動で外れる。
  // ============================================================
  const [rowSelection, setRowSelection] = useState({ sheetId: null, uids: [], anchor: null });
  // 貼り付け先が同じ見積かの判定用（未保存の新規見積でも同じ画面内なら同じ見積とみなす）
  const instanceKeyRef = useRef(`ed_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  // 保存で仮シートIDが確定IDに変わった対応（コピー後に保存してから貼った行のリンク①を保つため）
  const sheetIdAliasRef = useRef(new Map());

  const selSheetId = rowSelection.sheetId;
  // 選択行（シート内の表示順）
  const selectedRows = useMemo(
    () => (selSheetId == null ? [] : orderedSelection(items, selSheetId, new Set(rowSelection.uids))),
    [items, selSheetId, rowSelection.uids]);
  const selectedUidSet = useMemo(() => new Set(selectedRows.map(r => r._uid)), [selectedRows]);
  const firstSelectedUid = () => selectedRows[0]?._uid ?? null;
  const lastSelectedUid = () => selectedRows[selectedRows.length - 1]?._uid ?? null;

  // 元に戻すなどで消えた行は選択から外す（やり直しで行が戻っても選択は復活させない）
  useEffect(() => {
    if (selectedRows.length === rowSelection.uids.length) return;
    const uids = selectedRows.map(r => r._uid);
    setRowSelection(sel => (uids.length ? { ...sel, uids } : { sheetId: null, uids: [], anchor: null }));
  }, [selectedRows, rowSelection.uids.length]);

  const clearRowSelection = useCallback(() => {
    setRowSelection(sel => (sel.uids.length ? { sheetId: null, uids: [], anchor: null } : sel));
  }, []);
  clearRowSelectionRef.current = clearRowSelection;

  // 編集ロック中は選択できない
  useEffect(() => { if (isLocked) clearRowSelection(); }, [isLocked, clearRowSelection]);

  // 行の左端クリック: 単独選択／Shift で範囲／Ctrl(⌘) で追加・解除。別シートなら選び直し
  const selectRow = useCallback((sheetId, uid, { shift = false, ctrl = false } = {}) => {
    if (inputsLockedRef.current) return;
    setRowSelection(sel => {
      if (sel.sheetId !== sheetId || (!shift && !ctrl)) return { sheetId, uids: [uid], anchor: uid };
      if (shift) {
        const range = rangeUids(items, sheetId, sel.anchor ?? uid, uid);
        const uids = ctrl ? [...new Set([...sel.uids, ...range])] : range;
        return { ...sel, uids };
      }
      const has = sel.uids.includes(uid);
      return { sheetId, uids: has ? sel.uids.filter(u => u !== uid) : [...sel.uids, uid], anchor: uid };
    });
  }, [items]);

  const bulkDelete = useCallback((label = '行の一括削除', verb = '削除') => {
    if (!canEditNow() || selSheetId == null || selectedUidSet.size === 0) return;
    const count = selectedUidSet.size;
    const entry = editItems(label, { focus: { uid: firstSelectedUid(), col: 'name' } }, (prev) =>
      removeRows(prev, selSheetId, selectedUidSet, (sid) => newItemRow(sid, 0)));
    clearRowSelection();
    notifyWithUndo(entry, `${count}行を${verb}しました`);
  }, [selSheetId, selectedUidSet, editItems, clearRowSelection, notifyWithUndo, items]);

  const bulkDuplicate = useCallback(() => {
    if (!canEditNow() || selSheetId == null || selectedUidSet.size === 0) return;
    let newUids = [];
    editItems('行の一括複製', { focus: { uid: firstSelectedUid(), col: 'name' } }, (prev) => {
      const res = duplicateRows(prev, selSheetId, selectedUidSet, ROW_IDS);
      newUids = res.newUids;
      return res.items;
    });
    if (newUids.length) setRowSelection({ sheetId: selSheetId, uids: newUids, anchor: newUids[0] });
  }, [selSheetId, selectedUidSet, editItems, items]);

  const bulkMove = useCallback((dir) => {
    if (!canEditNow() || selSheetId == null || selectedUidSet.size === 0) return;
    editItems('行の一括移動', { focus: { uid: firstSelectedUid(), col: 'name' } }, (prev) =>
      moveRows(prev, selSheetId, selectedUidSet, dir));
  }, [selSheetId, selectedUidSet, editItems, items]);

  // 選択行のコピー内容（リンク行はコピー時点の実効値も持たせるため、計算済みの行を使う）
  const buildSelectionClipboard = () => {
    const rows = (itemsBySheet.get(selSheetId) || []).filter(r => selectedUidSet.has(r._uid));
    if (rows.length === 0) return null;
    const clip = buildRowsClipboard(rows, { estimateId, instanceKey: instanceKeyRef.current });
    lastRowsCopy = clip;
    return clip;
  };

  // クリップボードへ書き込む。キー操作（copy/cut イベント）なら event に書き、
  // ボタン操作なら Clipboard API を使う。
  const writeRowsClipboard = async (clip, event) => {
    if (event?.clipboardData) {
      event.clipboardData.setData('text/plain', clip.text);
      event.clipboardData.setData('text/html', clip.html);
      return true;
    }
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/plain': new Blob([clip.text], { type: 'text/plain' }),
          'text/html': new Blob([clip.html], { type: 'text/html' }),
        })]);
      } else {
        await navigator.clipboard.writeText(clip.text);
      }
      return true;
    } catch (e) {
      showToast('クリップボードへのコピーに失敗しました: ' + (e?.message || e), 'error');
      return false;
    }
  };

  const bulkCopy = useCallback(async (event) => {
    if (selSheetId == null || selectedUidSet.size === 0) return;
    const clip = buildSelectionClipboard();
    if (!clip) return;
    if (await writeRowsClipboard(clip, event)) {
      if (!event) showToast(`${selectedUidSet.size}行をコピーしました（Ctrl+V で選択行の下に貼り付け）`, 'success');
    }
  }, [selSheetId, selectedUidSet, itemsBySheet, estimateId, showToast]);

  const bulkCut = useCallback(async (event) => {
    if (!canEditNow() || selSheetId == null || selectedUidSet.size === 0) return;
    const clip = buildSelectionClipboard();
    if (!clip) return;
    if (await writeRowsClipboard(clip, event)) bulkDelete('行の切り取り', '切り取り');
  }, [selSheetId, selectedUidSet, itemsBySheet, estimateId, bulkDelete]);

  /**
   * 行の貼り付け。anchorUid の行の下に挿入する。
   * allowTsv=false のときは、このアプリでコピーした行データの場合だけ処理する
   * （セル内での Excel 貼り付けは従来どおり pasteTsv に任せるため）。
   * @returns 処理したら true
   */
  const pasteRows = useCallback((sheetId, anchorUid, clipboard, allowTsv) => {
    if (!canEditNow()) return false;
    const payload = parseRowsClipboard(clipboard, lastRowsCopy);
    const dataRows = payload ? payload.rows : (allowTsv ? rowsFromTsv(clipboard.text) : []);
    if (dataRows.length === 0) return false;
    const sameEstimate = !!payload && (
      payload.instanceKey === instanceKeyRef.current ||
      (payload.estimateId != null && payload.estimateId === estimateId));

    let newUids = [];
    const entry = editItems('行の貼り付け', { focus: { uid: anchorUid, col: 'name' } }, (prev, st) => {
      // リンクの取捨（同じ見積・参照先あり・循環なし）と切り取った工種の識別子の引き継ぎは pasteRowsInto
      const res = pasteRowsInto(prev, st.sheets, sheetId, anchorUid, dataRows, ROW_IDS, {
        sameEstimate,
        mapSheetId: (id) => sheetIdAliasRef.current.get(id) ?? id,
        wouldCreateCycle,
      });
      newUids = res.newUids;
      return res.items;
    });
    if (!entry) return false;
    setRowSelection({ sheetId, uids: newUids, anchor: newUids[0] });
    notifyWithUndo(entry, `${newUids.length}行を貼り付けました`);
    return true;
  }, [editItems, estimateId, notifyWithUndo]);

  // セルにカーソルがあるときの貼り付け（SheetPaper から）。アプリの行データならその行の下へ挿入
  const pasteRowsIntoCell = useCallback((uid, clipboard) => {
    const row = items.find(it => it._uid === uid);
    if (!row) return false;
    return pasteRows(row.sheet_id, uid, clipboard, false);
  }, [items, pasteRows]);

  // ============================================================
  // 品名の入力補完（過去の見積明細から。選ぶと品名・仕様・単位・単価を上書きし金額を再計算）
  // ============================================================
  const suggestErrorShownRef = useRef(false);
  const searchItemSuggestions = useCallback(async (query) => {
    try {
      return await searchEstimateItemSuggestions(query);
    } catch (e) {
      // 入力のたびに同じエラーが出続けないよう、通知は画面を開いている間に1回だけ
      if (!suggestErrorShownRef.current) {
        suggestErrorShownRef.current = true;
        showToast('品名の候補を取得できませんでした: ' + (e?.message || e), 'error');
      }
      return [];
    }
  }, [showToast]);

  const pickItemSuggestion = useCallback((uid, s) => {
    if (!canEditNow()) return;
    editItems('品名の候補を反映', { focus: { uid, col: 'name' } }, (prev) =>
      prev.map(it => (it._uid !== uid ? it : computeAutoAmount({
        ...it,
        name: s.name ?? it.name,
        spec: s.spec ?? '',
        unit: s.unit ?? '',
        unit_price: s.unit_price ?? '',
      }))));
  }, [editItems]);

  // ============================================================
  // 行のドラッグ移動（左端のつまみをつかむ。選択行をつかめば選択行をまとめて、
  // それ以外はその1行だけ。別シート・左ナビのシート名へも落とせる）
  // ============================================================
  const dragRowsRef = useRef(null);            // { uids: string[] } ドラッグ中の行
  const [dropIndicator, setDropIndicator] = useState(null); // { sheetId, uid, position } | null

  const handleRowDragStart = useCallback((uid) => {
    if (!canEditNow()) return false;
    const fromSelection = selectedUidSet.has(uid);
    const uids = fromSelection ? selectedRows.map(r => r._uid) : [uid];
    dragRowsRef.current = { uids, fromSelection };
    return true;
  }, [selectedUidSet, selectedRows]);

  // ドラッグ中の落とし先の更新（dragover は連続で来るので、変わったときだけ再描画する）
  const handleRowDragOver = useCallback((target) => {
    if (!dragRowsRef.current) return;
    setDropIndicator(cur => (cur && target && cur.sheetId === target.sheetId && cur.uid === target.uid &&
      cur.position === target.position ? cur : target));
  }, []);

  const handleRowDragEnd = useCallback(() => {
    dragRowsRef.current = null;
    setDropIndicator(null);
  }, []);

  /**
   * ドラッグした行を target（{ sheetId, uid, position }。uid が null ならシート末尾）へ移す。
   * 新たに循環参照が生じる移動は行わず、理由を通知する。
   */
  const dropDraggedRows = useCallback((target) => {
    const drag = dragRowsRef.current;
    handleRowDragEnd();
    if (!drag || !target || !canEditNow()) return;
    const uidSet = new Set(drag.uids);
    let cycle = false;
    const entry = editItems('行のドラッグ移動', { focus: { uid: drag.uids[0], col: 'name' } }, (prev, st) => {
      const anchor = target.uid ? { uid: target.uid, position: target.position } : null;
      const next = moveRowsTo(prev, uidSet, target.sheetId, anchor, (sid) => newItemRow(sid, 0));
      if (next === prev) return prev;
      const before = computeEstimateCalc(st.sheets, prev).cycleUids;
      const after = computeEstimateCalc(st.sheets, next).cycleUids;
      if ([...after].some(u => !before.has(u))) {
        cycle = true;
        return prev;
      }
      return next;
    });
    if (cycle) {
      showToast('循環参照になるため、その位置へは移動できません', 'error');
      return;
    }
    // 選択行を動かした場合は、移動先のシートで選択を保つ（選択はシート単位のため付け替える）
    if (entry && drag.fromSelection) {
      setRowSelection({ sheetId: target.sheetId, uids: drag.uids, anchor: drag.uids[0] });
    }
  }, [editItems, handleRowDragEnd, showToast]);

  // 左ナビのシート名へ落とす: そのシートの末尾へ
  const dropDraggedRowsToSheet = useCallback((sheetIndex) => {
    const sheet = sheets[sheetIndex];
    if (sheet) dropDraggedRows({ sheetId: sheet.id, uid: null, position: 'after' });
  }, [sheets, dropDraggedRows]);

  // ドラッグ中、画面の上下端に近づいたら自動スクロール（全画面表示中はその中を、通常は画面全体を）
  useEffect(() => {
    const EDGE = 60;
    const STEP = 18;
    const onDragOver = (e) => {
      if (!dragRowsRef.current) return;
      const dy = e.clientY < EDGE ? -STEP : e.clientY > window.innerHeight - EDGE ? STEP : 0;
      if (!dy) return;
      const box = document.querySelector('[data-estimate-fullscreen] [data-estimate-scroll]');
      if (box) box.scrollBy(0, dy);
      else window.scrollBy(0, dy);
    };
    window.addEventListener('dragover', onDragOver);
    return () => window.removeEventListener('dragover', onDragOver);
  }, []);

  // 行選択中のキー操作（入力欄・重ね画面の中では横取りしない）
  useEffect(() => {
    if (selSheetId == null || selectedUidSet.size === 0) return undefined;
    // 紙面（または何もフォーカスしていない状態）でだけ受ける。右パネル・左ナビのボタン等にフォーカスが
    // あるときに Delete や Ctrl+V で選択行が消えたり行が入ったりしないようにする
    const usable = (t) => (t === document.body || (t instanceof HTMLElement && !!t.closest('[data-estimate-undo-scope]'))) &&
      !isEditableEl(t) && !isInOverlay(t) && !document.querySelector('[aria-modal="true"]') && !previewOpen;
    const onKeyDown = (e) => {
      if (!usable(e.target) || e.isComposing) return;
      if (e.key === 'Escape') {
        // 全画面表示を閉じる Esc より先に、選択の解除だけを行う
        e.stopPropagation();
        clearRowSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); bulkDelete(); return; }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        bulkMove(e.key === 'ArrowUp' ? 'up' : 'down');
      }
    };
    // ページ上の文字を選んでいるときは通常のコピーに任せる
    const hasTextSelection = () => (window.getSelection?.().toString() || '') !== '';
    const onCopy = (e) => {
      if (!usable(document.activeElement) || hasTextSelection()) return;
      e.preventDefault();
      bulkCopy(e);
    };
    const onCut = (e) => {
      if (!usable(document.activeElement) || hasTextSelection()) return;
      e.preventDefault();
      bulkCut(e);
    };
    const onPaste = (e) => {
      if (!usable(document.activeElement)) return;
      const clipboard = {
        html: e.clipboardData?.getData('text/html') ?? '',
        text: e.clipboardData?.getData('text/plain') ?? '',
      };
      if (pasteRows(selSheetId, lastSelectedUid(), clipboard, true)) e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [selSheetId, selectedUidSet, previewOpen, clearRowSelection, bulkDelete, bulkMove, bulkCopy, bulkCut, pasteRows, selectedRows]);

  // 行のコピー以外の通常のコピーをしたら、直前の行コピーの記憶は捨てる
  // （同じ文字を普通にコピーして貼ったときに行の貼り付けと取り違えないため）
  useEffect(() => {
    const forget = (e) => { if (!e.defaultPrevented) lastRowsCopy = null; };
    window.addEventListener('copy', forget);
    window.addEventListener('cut', forget);
    return () => {
      window.removeEventListener('copy', forget);
      window.removeEventListener('cut', forget);
    };
  }, []);

  // SheetPaper へ渡す選択情報（選択中のシートにだけ渡す）
  const EMPTY_SET = useMemo(() => new Set(), []);
  const selectionPropsFor = (sheetId) => {
    const active = selSheetId === sheetId && selectedUidSet.size > 0;
    return {
      selectedUids: active ? selectedUidSet : EMPTY_SET,
      onSelectRow: (uid, mods) => selectRow(sheetId, uid, mods),
      onPasteRows: pasteRowsIntoCell,
      selectionActions: active ? {
        count: selectedUidSet.size,
        onDelete: () => bulkDelete(),
        onDuplicate: bulkDuplicate,
        onCopy: () => bulkCopy(),
        onCut: () => bulkCut(),
        onMove: bulkMove,
        onClear: clearRowSelection,
      } : null,
      // ドラッグ移動
      onRowDragStart: handleRowDragStart,
      onRowDragOver: handleRowDragOver,
      onRowDrop: dropDraggedRows,
      onRowDragEnd: handleRowDragEnd,
      dropIndicator: dropIndicator?.sheetId === sheetId ? dropIndicator : null,
      // 品名の入力補完
      onSearchItemSuggestions: searchItemSuggestions,
      onPickItemSuggestion: pickItemSuggestion,
    };
  };

  const handleUnlock = async () => {
    if (!isCreator) return false;
    return persistStatus({ status: ESTIMATE_STATUS.DRAFT });
  };

  // 見積番号の競合時、空いている枝番を自動で探して採番し直す
  const handleReissueNumber = async () => {
    if (operationInFlight.current || isLocked) return;
    try {
      setNumberError('');
      const newBranch = await findAvailableBranchNumber(
        header.estimate_number_date,
        header.estimate_number_seq,
        Number(header.estimate_number_branch) || 1
      );
      const branchPart = newBranch.split('-')[2];
      history.edit('枝番の再採番', {}, ({ header: h }) => ({ header: { ...h, estimate_number_branch: branchPart } }));
    } catch (e) {
      showToast('再採番に失敗しました: ' + e.message, 'error');
    }
  };

  // ============================================================
  // PDFプレビュー用データ構築（Phase 6: シートモデル対応）
  // 各シートを {id, title, items, sheetTotal} としてそのまま EstimateDocument へ渡す。
  // EstimatePDF 側がシートごとに末尾合計（トップ=税抜合計/サブ=合　計）を描画し、
  // 消費税・税込合計は鑑側にのみ出す。リンク解決済み resolvedItems（itemsBySheet）を使う。
  // ============================================================
  const buildPreviewEstimate = useCallback(() => {
    const customer = customers.find(c => String(c.id) === String(header.customer_id)) || null;
    const staff    = officeStaff.find(s => String(s.id) === String(header.staff_id))  || null;

    // 1シート分の明細を PDF 用に整形（COMMENTエンコード・SUBTOTAL除去・_tempId除去、
    // show_subtotals ON なら工種ごとの小計行を注入）。保存用ペイロード構築と同一の
    // パイプラインのため encodeSheetItemsForOutput に集約している（§9.17）。
    const buildSheetItems = (sheet) => encodeSheetItemsForOutput(itemsBySheet.get(sheet.id) || [], {
      showSubtotals: header.show_subtotals,
      subtotalExtraFields: (sortOrder) => ({ sort_order: sortOrder }),
    });

    const pdfSheets = sheets.map((sheet) => ({
      id: sheet.id,
      title: sheet.title || '',
      items: buildSheetItems(sheet),
      sheetTotal: sheetTotals.get(sheet.id) ?? null,
    }));

    return {
      ...header,
      estimate_number: estimateNumber,
      customer,
      staff,
      approver: officeStaff.find(s => String(s.id) === String(header.approved_by)) || null,
      sheets: pdfSheets,
      tax_rate:   Number(header.tax_rate),
      net_perc:   Number(header.net_perc),
      net_amount: header.net_amount !== '' ? Number(header.net_amount) : null,
    };
  }, [header, sheets, itemsBySheet, sheetTotals, customers, officeStaff, estimateNumber]);

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

  // Escape キーで明細シート全画面表示を閉じる
  useEffect(() => {
    if (fullscreenSheetIndex === null) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setFullscreenSheetIndex(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreenSheetIndex]);

  // 保存エラー発生時、原因箇所（鑑）が画面外にあっても気づけるようスクロールする
  const scrollToCover = () => {
    const el = document.getElementById('paper-cover');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ============================================================
  // 保存処理
  // ============================================================
  const buildCurrentSavePayload = async () => {
    if (isLocked) throw new Error('下書きに戻してから編集してください。');
    if (!header.customer_id) { scrollToCover(); throw new Error('顧客を選択してください。'); }
    if (!header.title.trim()) { scrollToCover(); throw new Error('工事名を入力してください。'); }
    if (!/^\d{6}-\d{4}-\d{3}$/.test(estimateNumber)) {
      throw new Error('見積番号の形式は YYMMDD-NNNN-NNN です。');
    }
    if (items.length > MAX_ROWS) throw new Error(`明細は${MAX_ROWS}行まで保存できます。`);
    if (await checkDuplicateNumber(estimateNumber, estimateId || null)) {
      const duplicate = new Error('この見積番号は既に使用されています。再採番してください。');
      duplicate.code = '23505';
      throw duplicate;
    }
    // 保存用明細を組み立てる（シート順に連結、COMMENTエンコード、SUBTOTAL注入）。
    // 空行の除去や name 空フィルタは行わない（Phase 3: 空行保持）。
    // プレビュー構築（buildSheetItems）と同一パイプラインのため
    // encodeSheetItemsForOutput に集約している（§9.17）。
    const savingItems = [];
    sheets.forEach((sheet) => {
      const sheetItems = encodeSheetItemsForOutput(itemsBySheet.get(sheet.id) || [], {
        showSubtotals: header.show_subtotals,
        extraFields: () => ({ sheet_id: sheet.id }),
        subtotalExtraFields: () => ({ sheet_id: sheet.id }),
      });

      savingItems.push(...sheetItems);
    });

    // 税込合計はトップシートの明細から算出（鑑と一致させる）
    const topSheetId = sheets[0]?.id;
    const savingTopItems = savingItems.filter(i => i.sheet_id === topSheetId);
    const savingTotals = calcTopSheetTotals(savingTopItems, header);

    // 他画面での工事削除により project_id が孤立参照（FK違反）になっていないか事前チェックする。
    // 孤立していれば連携を解除して保存を続行する（工事一覧から手動で再連携可能）。
    let safeProjectId = header.project_id || null;
    if (safeProjectId && !(await projectExists(safeProjectId))) {
      safeProjectId = null;
    }

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
      show_net:        header.show_net,
      show_subtotals:  header.show_subtotals,
      stamp_header:    header.stamp_header,
      show_approver:   true,
      show_reform_logo: !!header.show_reform_logo,
      staff_id:        header.staff_id ? Number(header.staff_id) : null,
      net_calc_type:   header.net_calc_type,
      net_perc:        Number(header.net_perc),
      net_amount:      header.net_amount !== '' ? Number(header.net_amount) : null,
      total_with_tax:  savingTotals.total,
      project_id:      safeProjectId,
    };

    const { payloadSheets, payloadItems } = buildSaveItemsPayload(sheets, savingItems);
    return { payload, payloadSheets, payloadItems };
  };

  const saveCurrentEstimate = async (approverStaffId = null) => {
    if (operationInFlight.current) return false;
    operationInFlight.current = true;
    setSaving(true);
    setError(null);
    setNumberError('');
    try {
      if (approverStaffId != null && !officeStaff.some(s => String(s.id) === String(approverStaffId) && s.is_approver)) {
        throw new Error('有効な承認者を選択してください。');
      }
      const { payload, payloadSheets, payloadItems } = await buildCurrentSavePayload();
      const saved = await saveEstimateV3(estimateId, payload, payloadSheets, payloadItems, approverStaffId);
      const savedHeader = {
        ...header, project_id: payload.project_id, status: saved.status,
        ...(approverStaffId != null ? { approver_staff_id: approverStaffId } : {}),
      };
      const idRemap = new Map(sheets.map((sheet, idx) => [sheet.id, saved.sheet_ids[idx]]));
      const savedSheets = sheets.map(sheet => ({ ...sheet, id: idRemap.get(sheet.id) }));
      const savedItems = items.map(item => ({
        ...item, sheet_id: idRemap.get(item.sheet_id) ?? item.sheet_id,
        linked_sheet_id: idRemap.get(item.linked_sheet_id) ?? item.linked_sheet_id,
      }));
      // 履歴内の仮シートIDも確定IDへ置き換え、DB上の現存シートを登録しておく
      const changedSheetIds = new Map([...idRemap].filter(([from, to]) => from !== to));
      history.remapSheetIds(changedSheetIds);
      changedSheetIds.forEach((to, from) => sheetIdAliasRef.current.set(from, to));
      history.setKnownSheetIds(saved.sheet_ids);
      setEstimateId(saved.id);
      setHeader(savedHeader);
      setSheets(savedSheets);
      setItems(savedItems);
      setOriginalStatus(saved.status);
      isDirty.current = false;
      skipNextDirtyCheck.current = true;
      clearEstimateDraft(estimateId);
      clearEstimateDraft(saved.id);
      saveLastSavedSnapshot(saved.id, { header: savedHeader, sheets: savedSheets, items: savedItems });
      showToast(approverStaffId != null ? '最新の内容を保存して承認を依頼しました' : '見積を保存しました', 'success');
      if (approverStaffId != null) onStatusChanged?.();
      else onSaved?.(saved.id);
      return true;
    } catch (e) {
      const message = e.code === '23505'
        ? `見積番号「${estimateNumber}」は既に使用されています。再採番してください。`
        : '保存・申請に失敗しました: ' + e.message;
      if (e.code === '23505') setNumberError(message);
      setError(message);
      showToast(message, 'error');
      return false;
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  };
  const handleSave = () => saveCurrentEstimate();

  // ============================================================
  // 自動退避データの復元／破棄
  // ============================================================
  const handleRestoreDraft = () => {
    if (operationInFlight.current || isLocked) return;
    if (pendingDraft) {
      // ステータスの変更はデータの変更とは別に管理する。
      // 退避データはステータスバッジ操作より前の古いステータスを含んでいる場合があるため、
      // 復元時はステータス関連フィールドを現在の値のまま維持し、退避データで上書きしない。
      setHeader(h => {
        const restored = { ...pendingDraft.header };
        SERVER_MANAGED_HEADER_FIELDS.forEach(f => { restored[f] = h[f]; });
        return restored;
      });
      setSheets(pendingDraft.sheets);
      // 旧スキーマの退避データには _uid が無い場合があるため補完する
      setItems((pendingDraft.items || []).map(it => it._uid ? it : { ...it, _uid: newUid() }));
      isDirty.current = true;
      history.clear();
    }
    setPendingDraft(null);
  };

  const handleDiscardDraft = () => {
    clearEstimateDraft(estimateId);
    setPendingDraft(null);
  };

  // 保存後に誤って明細を上書き・削除してしまった場合の救済:
  // 直近の保存成功時点の内容（このブラウザ内に3日間保持）に画面上の内容を戻す。
  // あくまで画面上の状態を戻すだけで、戻した後にあらためて「保存」を押すまでDBには反映されない。
  const handleRestoreLastSaved = () => {
    if (operationInFlight.current || isLocked) return;
    const snapshot = loadLastSavedSnapshot(estimateId);
    if (snapshot) {
      const entry = history.edit('直前の保存内容に戻す', {}, () => ({
        header: snapshot.header,
        sheets: snapshot.sheets,
        items: (snapshot.items || []).map(it => it._uid ? it : { ...it, _uid: newUid() }),
      }));
      notifyWithUndo(entry, '直前の保存内容に戻しました');
      isDirty.current = true;
    }
    setShowRestoreLastSaved(false);
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
          disabled={saving}
          onClick={() => (!isLocked && isDirty.current) ? setShowLeaveConfirm(true) : onBack()}
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
        {!isLocked && formatDraftAge(lastDraftSavedAt) && (
          <span
            className="flex items-center gap-1 text-xs text-slate-400"
            title="この端末のブラウザにのみ一時保存されています。別の端末では復元できません。正式に保存するには「保存」ボタンを押してください。"
          >
            <RefreshCw size={11} />
            この端末に自動保存済み（{formatDraftAge(lastDraftSavedAt)}）
          </span>
        )}
        {!isNew && !isLocked && loadLastSavedSnapshot(estimateId) && (
          <button
            onClick={() => setShowRestoreLastSaved(true)}
            disabled={saving}
            title="保存後に明細を誤って上書き・削除してしまった場合、直前に保存した内容へ画面を戻せます（このブラウザ内のみ・3日間有効。戻した後は改めて「保存」を押すまでDBには反映されません）"
            aria-label="直前の保存内容に戻す"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition"
          >
            <History size={12} />
            直前の保存内容に戻す
          </button>
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
      {/* この行に overflow を指定してはいけない: overflow が visible 以外だと左ナビ（PageNav）の
          sticky の基準がこの行になり、ウィンドウスクロールに追従しなくなる。
          実際のスクロールはウィンドウ（ドキュメント）レベルで発生する。 */}
      <div className="flex flex-1 min-h-0">

        {/* 左ナビ */}
        <div className="shrink-0 px-2 bg-white border-r border-slate-200">
          <PageNav
            sheets={sheets}
            items={items}
            onDeleteSheet={handleDeleteSheet}
            onAddSheet={handleAddSheet}
            isLocked={inputsLocked}
            onDropRowsToSheet={dropDraggedRowsToSheet}
            onRowsDragOverNav={() => handleRowDragOver(null)}
          />
        </div>

        {/* 中央: 紙面スタック（PC専用・横スクロール可） */}
        <div className="flex-1 min-w-0 overflow-x-auto bg-slate-200 py-8" data-estimate-undo-scope>
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
              isLocked={inputsLocked}
            />

            {/* 各明細シート */}
            {sheets.map((sheet, idx) => (
              <div key={sheet.id ?? idx} className="relative w-full flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setFullscreenSheetIndex(idx)}
                  title="このシートを全画面表示（両サイドの制約なしで広く編集）"
                  aria-label="このシートを全画面表示"
                  className="absolute -top-6 right-0 flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition"
                >
                  <Maximize2 size={13} />
                  全画面
                </button>
                <SheetPaper
                  sheet={sheet}
                  sheetIndex={idx}
                  items={itemsBySheet.get(sheet.id) || []}
                  header={header}
                  settings={settings}
                  totals={totals}
                  sheetTotal={sheetTotals.get(sheet.id)}
                  showTotalRow={shouldShowTotalRow(sheet, idx)}
                  cycleUids={cycleUids}
                  linkTargets={linkTargets}
                  startPageNumber={sheetStartPages[idx]}
                  isLocked={inputsLocked}
                  onUpdateItem={updateItem}
                  onAddRowAfter={addRowAfter}
                  onAddRowToSheet={addRowToSheet}
                  onRemoveRow={removeRow}
                  onDuplicateRow={duplicateRow}
                  onMoveRow={moveRow}
                  onPasteTsv={pasteTsv}
                  onSetRowLink={setRowLink}
                  {...selectionPropsFor(sheet.id)}
                />
              </div>
            ))}

            {/* シート追加（最終シート下） */}
            {!inputsLocked && (
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

        {/* 右: 設定パネル（overflow を付けると内部の sticky top-4 が効かなくなるので付けない） */}
        <div className="w-[280px] shrink-0 bg-white border-l border-slate-200 p-3">
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
            onGenerateSummary={handleGenerateSummary}
            currentEstimateId={estimateId}
            onOpenPreview={handleOpenPreview}
            onUndo={handleUndo}
            onRedo={handleRedo}
            undoLabel={history.undoLabel}
            redoLabel={history.redoLabel}
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
              title="PDFをダウンロード"
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
                {({ blob, loading: pdfLoading, error: pdfError }) => {
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
                    <EstimatePdfFrame blob={blob} fileName={estimatePdfFileName(previewSnapshot)} />
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

      {/* ===== 明細シート全画面表示オーバーレイ（両サイドの制約を受けずに1シートのみ表示） ===== */}
      {fullscreenSheetIndex !== null && sheets[fullscreenSheetIndex] && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-200" data-estimate-undo-scope data-estimate-fullscreen>

          {/* ミニヘッダー */}
          <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-4 shrink-0 flex-wrap">
            <span className="font-bold text-slate-700 text-sm flex items-center gap-1.5">
              <FileText size={16} className="text-blue-600" />
              {sheets[fullscreenSheetIndex].title || '見積内訳明細書'}
            </span>
            <span className="text-xs text-slate-500 truncate max-w-[40vw]">
              工事名：<span className="font-medium text-slate-700">{header.title || '（未入力）'}</span>
            </span>
            <span className="text-xs text-slate-500">
              工事金額：<span className="font-medium text-slate-700">¥{formatCurrency(totals.subtotal)}</span>
            </span>
            <span className="text-xs text-slate-500">
              税込合計：<span className="font-bold text-blue-700">¥{formatCurrency(totals.total)}</span>
            </span>
            <button
              onClick={() => setFullscreenSheetIndex(null)}
              title="全画面表示を閉じる（Esc）"
              aria-label="全画面表示を閉じる"
              className="ml-auto p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"
            >
              <Minimize2 size={18} />
            </button>
          </div>

          {/* シート表示エリア */}
          <div className="flex-1 min-h-0 overflow-auto py-8" data-estimate-scroll>
            <div className="flex flex-col items-center px-6">
              <SheetPaper
                sheet={sheets[fullscreenSheetIndex]}
                sheetIndex={fullscreenSheetIndex}
                items={itemsBySheet.get(sheets[fullscreenSheetIndex].id) || []}
                header={header}
                settings={settings}
                totals={totals}
                sheetTotal={sheetTotals.get(sheets[fullscreenSheetIndex].id)}
                showTotalRow={shouldShowTotalRow(sheets[fullscreenSheetIndex], fullscreenSheetIndex)}
                cycleUids={cycleUids}
                linkTargets={linkTargets}
                startPageNumber={sheetStartPages[fullscreenSheetIndex]}
                isLocked={inputsLocked}
                onUpdateItem={updateItem}
                onAddRowAfter={addRowAfter}
                onAddRowToSheet={addRowToSheet}
                onRemoveRow={removeRow}
                onDuplicateRow={duplicateRow}
                onMoveRow={moveRow}
                onPasteTsv={pasteTsv}
                onSetRowLink={setRowLink}
                {...selectionPropsFor(sheets[fullscreenSheetIndex].id)}
              />
            </div>
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

      {/* 直前の保存内容へ戻す確認（保存後の誤上書き・誤削除の救済） */}
      <ConfirmModal
        isOpen={showRestoreLastSaved}
        onClose={() => setShowRestoreLastSaved(false)}
        onConfirm={handleRestoreLastSaved}
        title="直前の保存内容に戻しますか？"
        message="直近に保存が成功した時点の内容に、画面上の表示を戻します。現在の未保存の変更は失われます。戻した後、この内容をサーバーに反映するには改めて「保存」を押す必要があります。"
        confirmText="戻す"
        cancelText="キャンセル"
        variant="primary"
      />
    </div>
  );
};

export default EstimateEditor;
