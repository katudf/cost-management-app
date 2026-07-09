// src/components/estimate/EstimateLostReasonModal.jsx
// 見積ステータスを「失注」へ変更する際、失注理由の入力を必須とする確認モーダル。

import React, { useState } from 'react';
import { XCircle } from 'lucide-react';

const EstimateLostReasonModal = ({ onConfirm, onCancel }) => {
  const [reason, setReason] = useState('');
  const canConfirm = reason.trim().length > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <XCircle size={22} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-slate-800 text-lg">この見積を失注にしますか？</h3>
            <p className="text-slate-500 text-sm mt-1">
              失注理由を入力してください。営業活動の振り返りに使用します。
            </p>
          </div>
        </div>

        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="失注理由を入力してください（必須）"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-5 resize-none"
        />

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold transition"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg text-white font-bold transition disabled:bg-slate-300 disabled:cursor-not-allowed bg-red-500 hover:bg-red-600"
          >
            失注にする
          </button>
        </div>
      </div>
    </div>
  );
};

export default EstimateLostReasonModal;
