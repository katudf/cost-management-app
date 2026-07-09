// src/components/estimate/EstimateSubmitModal.jsx
// 見積を「申請中」にする際、承認を依頼する担当者を指名するための確認モーダル。
// 指名された担当者（approver_staff_id）のみが後続の承認/差し戻しを行える。

import React, { useState } from 'react';
import { Send } from 'lucide-react';

const EstimateSubmitModal = ({ officeStaff, onConfirm, onCancel }) => {
  const [staffId, setStaffId] = useState('');
  const canConfirm = !!staffId;
  const approvers = officeStaff.filter(s => s.is_approver);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(Number(staffId));
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <Send size={22} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-slate-800 text-lg">承認を依頼しますか？</h3>
            <p className="text-slate-500 text-sm mt-1">
              承認者を選択してください。指名された担当者のみがこの見積を承認・差し戻しできます。
            </p>
          </div>
        </div>

        {approvers.length === 0 ? (
          <p className="w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm text-amber-700 mb-5">
            承認者に指定された担当者がいません。担当者・関係者管理で承認権限を設定してください。
          </p>
        ) : (
          <select
            value={staffId}
            onChange={e => setStaffId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white mb-5"
          >
            <option value="">-- 承認者を選択してください --</option>
            {approvers.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
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
            className="px-4 py-2 rounded-lg text-white font-bold transition disabled:bg-slate-300 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-600"
          >
            申請する
          </button>
        </div>
      </div>
    </div>
  );
};

export default EstimateSubmitModal;
