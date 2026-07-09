// src/components/estimate/ImportItemsModal.jsx
// 「過去見積から取込」モーダル。
// 過去の見積を選択 → 工種（CATEGORY）単位でチェックし、明細をコピーする。

import React, { useState, useEffect, useMemo } from 'react';
import { X, FileText, Search, Loader2 } from 'lucide-react';
import { ITEM_TYPE } from '../../utils/constants';
import { fetchEstimates, fetchEstimateById, formatCurrency } from '../../supabaseEstimates';

// 見積の明細をCATEGORY単位でグループ化
const groupByCategory = (items) => {
  const groups = [];
  let current = null;
  (items || []).forEach(item => {
    if (item.item_type === ITEM_TYPE.CATEGORY) {
      current = { category: item, rows: [], amount: 0 };
      groups.push(current);
    } else if (item.item_type === ITEM_TYPE.ITEM) {
      if (!current) {
        current = { category: null, rows: [], amount: 0 };
        groups.push(current);
      }
      current.rows.push(item);
      current.amount += Number(item.amount) || 0;
    }
    // FIXED / SUBTOTAL / COMMENT は取込対象外
  });
  return groups.filter(g => g.rows.length > 0);
};

const ImportItemsModal = ({ currentEstimateId, onImport, onClose }) => {
  const [step, setStep] = useState('list'); // 'list' | 'pick'
  const [estimates, setEstimates] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');

  const [selectedEstimate, setSelectedEstimate] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [groups, setGroups] = useState([]);
  const [checkedKeys, setCheckedKeys] = useState(new Set());

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchEstimates();
        setEstimates((data || []).filter(e => String(e.id) !== String(currentEstimateId)));
      } finally {
        setLoadingList(false);
      }
    })();
  }, [currentEstimateId]);

  const filteredEstimates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return estimates;
    return estimates.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.estimate_number || '').toLowerCase().includes(q) ||
      (e.customer?.name || '').toLowerCase().includes(q)
    );
  }, [estimates, search]);

  const handlePickEstimate = async (estimate) => {
    setSelectedEstimate(estimate);
    setStep('pick');
    setLoadingDetail(true);
    try {
      const full = await fetchEstimateById(estimate.id);
      const g = groupByCategory(full.items);
      setGroups(g);
      // デフォルトで全工種を選択済みにする
      setCheckedKeys(new Set(g.map((_, idx) => idx)));
    } finally {
      setLoadingDetail(false);
    }
  };

  const toggleGroup = (idx) => {
    setCheckedKeys(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleBackToList = () => {
    setStep('list');
    setSelectedEstimate(null);
    setGroups([]);
    setCheckedKeys(new Set());
  };

  const handleConfirmImport = () => {
    const selectedGroups = groups.filter((_, idx) => checkedKeys.has(idx));
    if (selectedGroups.length === 0) return;
    onImport(selectedGroups);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-blue-600" />
            <h3 className="font-bold text-slate-800 text-lg">過去見積から明細を取込</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            title="閉じる"
            className="text-slate-400 hover:text-slate-600 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* ボディ */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'list' && (
            <>
              <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="件名・見積番号・顧客名で検索"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {loadingList ? (
                <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  読み込み中...
                </div>
              ) : filteredEstimates.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-10">該当する見積がありません</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {filteredEstimates.map(e => (
                    <li key={e.id}>
                      <button
                        onClick={() => handlePickEstimate(e)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 text-sm truncate">{e.title || '(無題)'}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {e.estimate_number} {e.customer?.name ? `／ ${e.customer.name}` : ''}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">{(e.issue_date || '').slice(0, 10)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {step === 'pick' && (
            <>
              <button
                onClick={handleBackToList}
                className="text-xs text-blue-600 hover:text-blue-800 font-bold mb-3"
              >
                ← 見積一覧に戻る
              </button>
              <p className="text-sm text-slate-600 mb-3">
                <span className="font-bold">{selectedEstimate?.title}</span>（{selectedEstimate?.estimate_number}）から取込む工種を選択してください。
              </p>

              {loadingDetail ? (
                <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  読み込み中...
                </div>
              ) : groups.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-10">取込可能な明細がありません</p>
              ) : (
                <ul className="space-y-2">
                  {groups.map((g, idx) => (
                    <li key={idx}>
                      <label className="flex items-start gap-2 border border-slate-200 rounded-lg p-3 cursor-pointer hover:bg-slate-50 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                        <input
                          type="checkbox"
                          checked={checkedKeys.has(idx)}
                          onChange={() => toggleGroup(idx)}
                          className="mt-1"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-slate-700">
                              {g.category?.category_symbol ? `${g.category.category_symbol}．` : ''}
                              {g.category?.name || '(工種名なし)'}
                            </span>
                            <span className="text-sm font-bold text-slate-600 shrink-0">{formatCurrency(g.amount)}</span>
                          </span>
                          <span className="text-xs text-slate-400">{g.rows.length}行</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* フッター */}
        {step === 'pick' && (
          <div className="flex gap-3 justify-end px-5 py-4 border-t border-slate-200 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold transition"
            >
              キャンセル
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={checkedKeys.size === 0}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold transition"
            >
              選択した工種を取込む（{checkedKeys.size}件）
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportItemsModal;
