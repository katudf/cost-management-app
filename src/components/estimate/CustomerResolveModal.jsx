// src/components/estimate/CustomerResolveModal.jsx
// Excel取込時、顧客名がマスタと一致しなかった場合の確認モーダル。
// 「新規顧客として登録」「既存顧客に紐づけ」「キャンセル」の3択を提示する。
// 表記ゆれ（「㈱」と「株式会社」等）による顧客マスタの重複登録を防ぐ。

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

const CustomerResolveModal = ({ customerName, customers, onRegisterNew, onLinkExisting, onCancel }) => {
  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [selectedId, setSelectedId] = useState('');

  const handleConfirm = () => {
    if (mode === 'new') {
      onRegisterNew();
    } else if (selectedId) {
      onLinkExisting(selectedId);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle size={22} className="text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-slate-800 text-lg">顧客が見つかりません</h3>
            <p className="text-slate-500 text-sm mt-1">
              取込データの顧客名 <span className="font-bold text-slate-700">「{customerName}」</span> は
              顧客マスタに一致するものがありません。どちらかを選択してください。
            </p>
          </div>
        </div>

        <div className="space-y-2 mb-5">
          <label className="flex items-start gap-2 border border-slate-200 rounded-lg p-3 cursor-pointer hover:bg-slate-50 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
            <input
              type="radio"
              name="customer-resolve-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              className="mt-1"
            />
            <span className="text-sm text-slate-700">
              <span className="font-bold">新規顧客として登録する</span>
              <br />
              「{customerName}」を顧客マスタに新規追加します。
            </span>
          </label>

          <label className="flex items-start gap-2 border border-slate-200 rounded-lg p-3 cursor-pointer hover:bg-slate-50 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
            <input
              type="radio"
              name="customer-resolve-mode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
              className="mt-1"
            />
            <span className="text-sm text-slate-700 flex-1">
              <span className="font-bold">既存顧客に紐づける</span>
              <br />
              <select
                value={selectedId}
                onChange={e => { setSelectedId(e.target.value); setMode('existing'); }}
                onClick={() => setMode('existing')}
                className="w-full mt-2 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="">-- 選択してください --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </span>
          </label>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold transition"
          >
            取込を中断
          </button>
          <button
            onClick={handleConfirm}
            disabled={mode === 'existing' && !selectedId}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold transition"
          >
            この内容で続行
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerResolveModal;
