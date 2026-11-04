// src/components/ProjectExcelImportModal.jsx
// 現場管理タブのExcel取込：取込内容（工事名・顧客・明細数・合計）の確認モーダル。
// 取込した現場は 見積=下書き / 現場=予定 で作成される。

import React, { useState } from 'react';
import { FileSpreadsheet, AlertTriangle } from 'lucide-react';

const ProjectExcelImportModal = ({ parsed, fileName, customerLabel, customerId, existingSiteNames = [], busy, onConfirm, onCancel }) => {
  const defaultName = parsed.projectName || fileName.replace(/\.[^/.]+$/, '');
  const [projectName, setProjectName] = useState(defaultName);

  const items = (parsed.items || []).filter(i => i.name?.trim());
  const total = items.reduce((sum, i) => {
    const amt = i.amount !== '' && i.amount != null ? Number(i.amount) : 0;
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);
  const trimmed = projectName.trim();
  const isDuplicate = trimmed !== '' && existingSiteNames.includes(trimmed);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <FileSpreadsheet size={22} className="text-green-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Excelから現場を取り込み</h3>
            <p className="text-slate-500 text-sm mt-1">現場を予定ステータスで登録します（見積は下書きとして作成）。</p>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <label className="block text-sm">
            <span className="font-bold text-slate-700">工事名</span>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
          <dl className="text-sm grid grid-cols-[6rem_1fr] gap-y-1">
            <dt className="text-slate-500">顧客</dt>
            <dd className="text-slate-800">{customerLabel || '（未設定）'}</dd>
            <dt className="text-slate-500">明細数</dt>
            <dd className="text-slate-800">{items.length} 件</dd>
            <dt className="text-slate-500">合計金額</dt>
            <dd className="text-slate-800">¥{total.toLocaleString()}</dd>
          </dl>
          {!customerId && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>顧客が特定できないため取り込めません。Excelに顧客名を入れるか、既存顧客に紐付けてください。</span>
            </div>
          )}
          {isDuplicate && (
            <div className="flex items-start gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg p-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>同名の現場が既にあります。このまま取り込むと同名の現場が2件になります。</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold transition"
          >
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(trimmed)}
            disabled={busy || !customerId || !trimmed || items.length === 0}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold transition"
          >
            {busy ? '取込中...' : '取り込む'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectExcelImportModal;
