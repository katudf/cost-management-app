// src/EstimateList.jsx
// 見積書一覧画面

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, FileText, Copy, Trash2, Edit, Download, ChevronDown, Upload, Loader2 } from 'lucide-react';
import {
  fetchEstimates,
  deleteEstimate,
  duplicateEstimate,
  fetchEstimateById,
  formatCurrency,
  createEstimate,
  createCustomer,
  saveEstimateItems,
  getNextEstimateSeq,
  fetchCustomers,
  findAvailableBranchNumber,
  fetchSystemSettings,
} from './supabaseEstimates';
import CustomerResolveModal from './components/estimate/CustomerResolveModal';
import { downloadEstimatePDF } from './EstimatePDF';
import { parseExcelForEstimate } from './utils/excelImportUtils';
import { useToast } from './components/Toast';
import { ESTIMATE_STATUS, ESTIMATE_STATUS_LABEL } from './utils/constants';

// ステータス表示設定（ラベルは constants の定数を参照）
const STATUS_CONFIG = {
  [ESTIMATE_STATUS.DRAFT]:     { label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.DRAFT],     className: 'bg-slate-100 text-slate-600' },
  [ESTIMATE_STATUS.PENDING]:   { label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.PENDING],   className: 'bg-yellow-100 text-yellow-700' },
  [ESTIMATE_STATUS.APPROVED]:  { label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.APPROVED],  className: 'bg-green-100 text-green-700' },
  [ESTIMATE_STATUS.RETURNED]:  { label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.RETURNED],  className: 'bg-red-100 text-red-600' },
  [ESTIMATE_STATUS.SUBMITTED]: { label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.SUBMITTED], className: 'bg-blue-100 text-blue-700' },
  [ESTIMATE_STATUS.ORDERED]:   { label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.ORDERED],   className: 'bg-emerald-100 text-emerald-700' },
  [ESTIMATE_STATUS.LOST]:      { label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.LOST],      className: 'bg-rose-100 text-rose-700' },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG[ESTIMATE_STATUS.DRAFT];
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
};

// ============================================================
// 見積有効期限バッジ
// ------------------------------------------------------------
// valid_until が今日より前なら「期限切れ」、7日以内なら「期限間近」を表示。
// 承認済み・返却済みの見積は期限管理の対象外として非表示にする。
// ============================================================
const EXPIRY_SOON_THRESHOLD_DAYS = 7;

const getExpiryInfo = (validUntil) => {
  if (!validUntil) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(validUntil);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'expired';
  if (diffDays <= EXPIRY_SOON_THRESHOLD_DAYS) return 'soon';
  return null;
};

const ExpiryBadge = ({ validUntil, status }) => {
  if (status === ESTIMATE_STATUS.APPROVED || status === ESTIMATE_STATUS.RETURNED) return null;
  const info = getExpiryInfo(validUntil);
  if (!info) return null;

  if (info === 'expired') {
    return (
      <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">
        期限切れ
      </span>
    );
  }
  return (
    <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
      期限間近
    </span>
  );
};

// ============================================================
// メインコンポーネント
// ============================================================
const EstimateList = ({ onEdit }) => {
  const { showToast } = useToast();
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // 削除確認対象のID
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState(null); // 顧客未確定のExcel取込データ
  const fileInputRef = useRef(null);

  // 一覧取得
  const loadEstimates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchEstimates();
      setEstimates(data);
    } catch (e) {
      setError('見積書の読み込みに失敗しました: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEstimates(); }, [loadEstimates]);

  // フィルタリング
  const filtered = estimates.filter(e => {
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    const q = searchText.toLowerCase();
    const matchSearch = !q
      || e.estimate_number?.toLowerCase().includes(q)
      || e.title?.toLowerCase().includes(q)
      || e.customer?.name?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  // 削除
  const handleDelete = async (id) => {
    try {
      await deleteEstimate(id);
      setEstimates(prev => prev.filter(e => e.id !== id));
      setConfirmDelete(null);
    } catch (e) {
      showToast('削除に失敗しました: ' + e.message, 'error');
    }
  };

  // 複製
  const handleDuplicate = async (estimate) => {
    try {
      const newEst = await duplicateEstimate(estimate.id);
      await loadEstimates();
      onEdit(newEst.id); // 複製後すぐ編集画面へ
    } catch (e) {
      showToast('複製に失敗しました: ' + e.message, 'error');
    }
  };

  const handleDownloadPDF = async (estimate) => {
    try {
      console.log('[PDF] 見積データ取得開始:', estimate.id);
      // 明細データを含む完全な見積書を取得
      const full = await fetchEstimateById(estimate.id);
      console.log('[PDF] 見積データ取得完了, items:', full?.items?.length);

      // システム設定（自社情報）を取得
      const settings = await fetchSystemSettings();
      console.log('[PDF] システム設定取得完了:', settings?.company_name);

      console.log('[PDF] PDF生成開始...');
      await downloadEstimatePDF(full, settings);
      console.log('[PDF] PDF生成完了');
    } catch (e) {
      console.error('[PDF] エラー:', e);
      showToast('PDF生成に失敗しました: ' + e.message, 'error');
    }
  };

  // Excelインポート処理
  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    setImporting(true);
    setError(null);
    try {
      // Excelパース
      const result = await parseExcelForEstimate(file);
      if (!result.items || result.items.length === 0) {
        setError('取り込めるデータが見つかりませんでした。');
        setImporting(false);
        return;
      }

      // 見積番号の自動採番（重複回避付き）
      const d = new Date();
      const yy = String(d.getFullYear()).slice(2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const prefix = `${yy}${mm}${dd}`;
      const seq = await getNextEstimateSeq(prefix);

      // 枝番001から開始し、重複があれば空き番号まで繰り上げる
      const estimateNumber = await findAvailableBranchNumber(prefix, seq, 1);

      // 顧客の検索。完全一致すればそのまま続行、無ければ確認モーダルで
      // 「新規登録／既存に紐づけ」を選んでもらう。
      if (result.customerName) {
        const customers = await fetchCustomers();
        const found = customers.find(c => c.name === result.customerName);
        if (found) {
          await continueExcelImport({ file, result, estimateNumber, customerId: found.id });
        } else {
          setPendingImport({ file, result, estimateNumber, customers, customerName: result.customerName });
          setImporting(false);
        }
      } else {
        await continueExcelImport({ file, result, estimateNumber, customerId: null });
      }
    } catch (err) {
      console.error('Excel取込エラー:', err);
      setError('Excelの取り込みに失敗しました: ' + err.message);
      setImporting(false);
    }
  };

  // 顧客が確定した後の取込続行処理（新規見積の作成～明細保存～遷移）
  const continueExcelImport = async ({ file, result, estimateNumber, customerId }) => {
    setImporting(true);
    setError(null);
    try {
      // 見積書ヘッダーを作成
      const payload = {
        estimate_number: estimateNumber,
        customer_id: customerId,
        customer_honorific: '御中',
        title: result.projectName || file.name.replace(/\.[^/.]+$/, ''),
        site_location: null,
        work_period: null,
        issue_date: new Date().toISOString().split('T')[0],
        valid_until: null,
        payment_terms: '従来通り',
        notes: result.notes || null,
        tax_rate: 0.10,
        status: ESTIMATE_STATUS.DRAFT,
        show_fixed_fees: false,
        show_net: true,
        show_subtotals: false,
        stamp_header: 'company',
        show_approver: false,
        staff_id: null,
        net_calc_type: 'perc',
        net_perc: 95,
        net_amount: null,
        total_with_tax: 0,
      };

      const created = await createEstimate(payload);

      // 明細保存
      const saveableItems = result.items
        .filter(i => i.name?.trim())
        .map((item, idx) => ({
          ...item,
          estimate_id: created.id,
          sort_order: idx,
          quantity: item.quantity != null ? Number(item.quantity) : null,
          unit_price: item.unit_price !== '' && item.unit_price != null ? Number(item.unit_price) : null,
          amount: item.amount !== '' && item.amount != null ? Number(item.amount) : null,
        }));
      await saveEstimateItems(created.id, saveableItems);

      // 作成した見積書の編集画面に遷移
      onEdit(created.id);
    } catch (err) {
      console.error('Excel取込エラー:', err);
      setError('Excelの取り込みに失敗しました: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  // 顧客確認モーダル: 新規登録を選択
  const handleResolveAsNewCustomer = async () => {
    const pending = pendingImport;
    if (!pending) return;
    setPendingImport(null);
    try {
      setImporting(true);
      const newCust = await createCustomer(pending.customerName);
      await continueExcelImport({ ...pending, customerId: newCust.id });
    } catch (err) {
      console.error('顧客登録エラー:', err);
      setError('顧客の登録に失敗しました: ' + err.message);
      setImporting(false);
    }
  };

  // 顧客確認モーダル: 既存顧客に紐づけを選択
  const handleResolveAsExistingCustomer = async (customerId) => {
    const pending = pendingImport;
    if (!pending) return;
    setPendingImport(null);
    await continueExcelImport({ ...pending, customerId });
  };

  // 顧客確認モーダル: キャンセル（取込を中断）
  const handleCancelPendingImport = () => {
    setPendingImport(null);
  };

  // ============================================================
  // レンダリング
  // ============================================================
  return (
    <div className="p-4 md:p-6">

      {/* ヘッダー */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <FileText size={22} className="text-blue-600" />
          見積書管理
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept=".xlsx, .xls"
            onChange={handleExcelImport}
            ref={fileInputRef}
            className="hidden"
            id="estimate-excel-upload"
          />
          <label
            htmlFor="estimate-excel-upload"
            className={`flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold transition cursor-pointer ${importing ? 'opacity-60 pointer-events-none' : ''}`}
          >
            {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {importing ? '取込中...' : 'Excelから取込'}
          </label>
          <button
            onClick={() => onEdit(null)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold transition"
          >
            <Plus size={18} />
            新規作成
          </button>
        </div>
      </div>

      {/* 検索・フィルター */}
      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <input
          type="text"
          placeholder="見積No・工事名・顧客名で検索..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex gap-1 flex-wrap">
          {[
            { key: 'all',                      label: 'すべて' },
            { key: ESTIMATE_STATUS.DRAFT,      label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.DRAFT] },
            { key: ESTIMATE_STATUS.PENDING,    label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.PENDING] },
            { key: ESTIMATE_STATUS.APPROVED,   label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.APPROVED] },
            { key: ESTIMATE_STATUS.RETURNED,   label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.RETURNED] },
            { key: ESTIMATE_STATUS.SUBMITTED,  label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.SUBMITTED] },
            { key: ESTIMATE_STATUS.ORDERED,    label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.ORDERED] },
            { key: ESTIMATE_STATUS.LOST,       label: ESTIMATE_STATUS_LABEL[ESTIMATE_STATUS.LOST] },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                statusFilter === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* ローディング */}
      {loading && (
        <div className="text-center py-12 text-slate-400">読み込み中...</div>
      )}

      {/* テーブル */}
      {!loading && (
        <>
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <FileText size={40} className="mx-auto mb-3 opacity-30" />
              <p>見積書がありません</p>
              {statusFilter !== 'all' && (
                <button
                  onClick={() => setStatusFilter('all')}
                  className="mt-2 text-blue-500 text-sm underline"
                >
                  フィルターを解除する
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-left">
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">見積No</th>
                    <th className="px-4 py-3 font-semibold">工事名</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">顧客</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">見積日</th>
                    <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">税込合計</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">ステータス</th>
                    <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(estimate => (
                    <EstimateRow
                      key={estimate.id}
                      estimate={estimate}
                      onEdit={() => onEdit(estimate.id)}
                      onDuplicate={() => handleDuplicate(estimate)}
                      onDelete={() => setConfirmDelete(estimate)}
                      onDownload={() => handleDownloadPDF(estimate)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 件数表示 */}
          {filtered.length > 0 && (
            <p className="text-right text-xs text-slate-400 mt-2">
              {filtered.length}件表示
              {statusFilter !== 'all' || searchText ? `（全${estimates.length}件中）` : ''}
            </p>
          )}
        </>
      )}

      {/* 削除確認ダイアログ */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="font-bold text-slate-800 text-lg mb-2">見積書を削除しますか？</h3>
            <p className="text-slate-500 text-sm mb-1">
              <span className="font-bold">{confirmDelete.estimate_number}</span>
            </p>
            <p className="text-slate-500 text-sm mb-5">{confirmDelete.title}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold transition"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold transition"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excel取込: 顧客未一致の確認モーダル */}
      {pendingImport && (
        <CustomerResolveModal
          customerName={pendingImport.customerName}
          customers={pendingImport.customers}
          onRegisterNew={handleResolveAsNewCustomer}
          onLinkExisting={handleResolveAsExistingCustomer}
          onCancel={handleCancelPendingImport}
        />
      )}
    </div>
  );
};

// ============================================================
// テーブル行コンポーネント
// ============================================================
const EstimateRow = ({ estimate, onEdit, onDuplicate, onDelete, onDownload }) => {
  // 税込合計（保存時にDBに記録される値）
  const total = estimate.total_with_tax;

  return (
    <tr className="hover:bg-slate-50 transition">
      <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
        {estimate.estimate_number}
      </td>
      <td className="px-4 py-3 text-slate-800 font-medium max-w-xs">
        <span className="line-clamp-2">{estimate.title}</span>
      </td>
      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
        {estimate.customer?.name || '-'}
      </td>
      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
        {estimate.issue_date
          ? new Date(estimate.issue_date).toLocaleDateString('ja-JP', {
              year: 'numeric', month: 'numeric', day: 'numeric'
            })
          : '-'}
        <ExpiryBadge validUntil={estimate.valid_until} status={estimate.status} />
      </td>
      <td className="px-4 py-3 text-right font-mono text-slate-700 whitespace-nowrap">
        {total != null ? `¥${formatCurrency(total)}-` : '-'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <StatusBadge status={estimate.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-center gap-1">
          {/* PDF出力 */}
          <button
            onClick={onDownload}
            aria-label="PDFプレビュー・印刷"
            title="PDFプレビュー・印刷"
            className="p-1.5 rounded-md hover:bg-green-50 text-green-600 transition"
          >
            <Download size={16} />
          </button>
          {/* 編集 */}
          <button
            onClick={onEdit}
            aria-label="編集"
            title="編集"
            className="p-1.5 rounded-md hover:bg-blue-50 text-blue-600 transition"
          >
            <Edit size={16} />
          </button>
          {/* 複製 */}
          <button
            onClick={onDuplicate}
            aria-label="複製"
            title="複製"
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
          >
            <Copy size={16} />
          </button>
          {/* 削除 */}
          <button
            onClick={onDelete}
            aria-label="削除"
            title="削除"
            className="p-1.5 rounded-md hover:bg-red-50 text-red-500 transition"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
};

export default EstimateList;
