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
  saveEstimateItems,
  getNextEstimateSeq,
  fetchCustomers,
} from './supabaseEstimates';
import { downloadEstimatePDF } from './EstimatePDF';
import { supabase } from './lib/supabase';
import { parseExcelForEstimate } from './utils/excelImportUtils';

// ステータス表示設定
const STATUS_CONFIG = {
  draft:     { label: '下書き',   className: 'bg-slate-100 text-slate-600' },
  pending:   { label: '申請中',   className: 'bg-yellow-100 text-yellow-700' },
  approved:  { label: '承認',     className: 'bg-green-100 text-green-700' },
  returned:  { label: '差し戻し', className: 'bg-red-100 text-red-600' },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
};

// ============================================================
// メインコンポーネント
// ============================================================
const EstimateList = ({ onEdit }) => {
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // 削除確認対象のID
  const [importing, setImporting] = useState(false);
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
      alert('削除に失敗しました: ' + e.message);
    }
  };

  // 複製
  const handleDuplicate = async (estimate) => {
    try {
      const newEst = await duplicateEstimate(estimate.id);
      await loadEstimates();
      onEdit(newEst.id); // 複製後すぐ編集画面へ
    } catch (e) {
      alert('複製に失敗しました: ' + e.message);
    }
  };

  const handleDownloadPDF = async (estimate) => {
    try {
      console.log('[PDF] 見積データ取得開始:', estimate.id);
      // 明細データを含む完全な見積書を取得
      const full = await fetchEstimateById(estimate.id);
      console.log('[PDF] 見積データ取得完了, items:', full?.items?.length);

      // システム設定（自社情報）を取得
      const { data: settings } = await supabase
        .from('system_settings')
        .select('*')
        .eq('id', 1)
        .single();
      console.log('[PDF] システム設定取得完了:', settings?.company_name);

      console.log('[PDF] PDF生成開始...');
      await downloadEstimatePDF(full, settings);
      console.log('[PDF] PDF生成完了');
    } catch (e) {
      console.error('[PDF] エラー:', e);
      alert('PDF生成に失敗しました: ' + e.message);
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

      // 枝番001から開始し、重複があればインクリメント
      let branch = 1;
      let estimateNumber = `${prefix}-${seq}-${String(branch).padStart(3, '0')}`;
      const { checkDuplicateNumber } = await import('./supabaseEstimates');
      while (await checkDuplicateNumber(estimateNumber)) {
        branch++;
        estimateNumber = `${prefix}-${seq}-${String(branch).padStart(3, '0')}`;
        if (branch > 999) throw new Error('見積番号の採番に失敗しました（枝番上限）');
      }

      // 顧客の検索・紐付け
      let customerId = null;
      if (result.customerName) {
        const customers = await fetchCustomers();
        const found = customers.find(c => c.name === result.customerName);
        if (found) {
          customerId = found.id;
        } else {
          // 新規顧客を登録
          const { data: newCust, error: custErr } = await supabase
            .from('Customers')
            .insert([{ name: result.customerName }])
            .select();
          if (!custErr && newCust?.length > 0) customerId = newCust[0].id;
        }
      }

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
        status: 'draft',
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
            { key: 'all',       label: 'すべて' },
            { key: 'draft',     label: '下書き' },
            { key: 'pending',   label: '申請中' },
            { key: 'approved',  label: '承認' },
            { key: 'returned',  label: '差し戻し' },
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
            title="PDFプレビュー・印刷"
            className="p-1.5 rounded-md hover:bg-green-50 text-green-600 transition"
          >
            <Download size={16} />
          </button>
          {/* 編集 */}
          <button
            onClick={onEdit}
            title="編集"
            className="p-1.5 rounded-md hover:bg-blue-50 text-blue-600 transition"
          >
            <Edit size={16} />
          </button>
          {/* 複製 */}
          <button
            onClick={onDuplicate}
            title="複製"
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition"
          >
            <Copy size={16} />
          </button>
          {/* 削除 */}
          <button
            onClick={onDelete}
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
