// src/EstimateList.jsx
// 見積書一覧画面

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, FileText, Copy, Trash2, Edit, Download, ChevronDown } from 'lucide-react';
import {
  fetchEstimates,
  deleteEstimate,
  duplicateEstimate,
  fetchEstimateById,
  formatCurrency,
} from './supabaseEstimates';
import { downloadEstimatePDF } from './EstimatePDF';
import { supabase } from './lib/supabase';

// ステータス表示設定
const STATUS_CONFIG = {
  draft:     { label: '下書き',   className: 'bg-slate-100 text-slate-600' },
  submitted: { label: '提出済み', className: 'bg-blue-100 text-blue-700' },
  accepted:  { label: '受注',     className: 'bg-green-100 text-green-700' },
  rejected:  { label: '失注',     className: 'bg-red-100 text-red-600' },
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
        <button
          onClick={() => onEdit(null)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold transition"
        >
          <Plus size={18} />
          新規作成
        </button>
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
            { key: 'submitted', label: '提出済み' },
            { key: 'accepted',  label: '受注' },
            { key: 'rejected',  label: '失注' },
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
