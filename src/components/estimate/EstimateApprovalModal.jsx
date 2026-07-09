// src/components/estimate/EstimateApprovalModal.jsx
// 見積ステータスを「承認」「差し戻し」へ変更する際、承認者・差し戻し理由を記録するための確認モーダル。
// 承認: ログイン中の本人（指名された承認者）の名前で記録する（呼び出し元でも本人確認済み）。
// 差し戻し: 理由の入力を必須とする。

import React, { useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';

const EstimateApprovalModal = ({ mode, currentStaff, onConfirm, onCancel }) => {
  const isApprove = mode === 'approved';
  const [reason, setReason] = useState('');

  const canConfirm = isApprove ? true : reason.trim().length > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    if (isApprove) {
      onConfirm({});
    } else {
      onConfirm({ reason: reason.trim() });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          {isApprove
            ? <CheckCircle2 size={22} className="text-green-600 shrink-0 mt-0.5" />
            : <RotateCcw size={22} className="text-red-500 shrink-0 mt-0.5" />
          }
          <div>
            <h3 className="font-bold text-slate-800 text-lg">
              {isApprove ? 'この見積を承認しますか？' : 'この見積を差し戻しますか？'}
            </h3>
            <p className="text-slate-500 text-sm mt-1">
              {isApprove
                ? `承認者「${currentStaff?.name || ''}」として承認します。承認日時とあわせて記録されます。`
                : '差し戻し理由を入力してください。担当者への申し送り事項として記録されます。'}
            </p>
          </div>
        </div>

        {isApprove ? (
          <div className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-700 mb-5">
            承認者: <span className="font-bold">{currentStaff?.name || '(不明)'}</span>
          </div>
        ) : (
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="差し戻し理由を入力してください（必須）"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-5 resize-none"
          />
        )}

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
            className={`px-4 py-2 rounded-lg text-white font-bold transition disabled:bg-slate-300 disabled:cursor-not-allowed ${
              isApprove ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            {isApprove ? '承認する' : '差し戻す'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EstimateApprovalModal;
