import React from 'react';
import { User } from 'lucide-react';

const WorkerEditModal = ({ isOpen, editingWorker, setEditingWorker, onClose, onSave }) => {
    if (!isOpen || !editingWorker) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2 border-b pb-3">
                    <User className="text-blue-500" />
                    {editingWorker.id ? '作業員情報の編集' : '新規作業員の追加'}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">氏名 <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={editingWorker.name || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, name: e.target.value })}
                            className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold text-slate-700 outline-none focus:border-blue-500"
                            placeholder="例: 佐藤 太郎"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">ふりがな</label>
                        <input
                            type="text"
                            value={editingWorker.kana || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, kana: e.target.value })}
                            className="w-full border border-slate-200 p-2.5 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500"
                            placeholder="例: さとう たろう"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">生年月日</label>
                        <input
                            type="date"
                            value={editingWorker.birthDate || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, birthDate: e.target.value })}
                            className="w-full border border-slate-200 p-2.5 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">入社日</label>
                        <input
                            type="date"
                            value={editingWorker.hireDate || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, hireDate: e.target.value })}
                            className="w-full border border-slate-200 p-2.5 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">退社日</label>
                        <input
                            type="date"
                            value={editingWorker.resignation_date || ''}
                            onChange={(e) => setEditingWorker({ ...editingWorker, resignation_date: e.target.value })}
                            className="w-full border border-slate-200 p-2.5 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500"
                        />
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">連絡先 (電話番号等)</label>
                    <input
                        type="text"
                        value={editingWorker.contactInfo || ''}
                        onChange={(e) => setEditingWorker({ ...editingWorker, contactInfo: e.target.value })}
                        className="w-full border border-slate-200 p-2.5 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500"
                        placeholder="例: 090-1234-5678"
                    />
                </div>

                <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">住所</label>
                    <input
                        type="text"
                        value={editingWorker.address || ''}
                        onChange={(e) => setEditingWorker({ ...editingWorker, address: e.target.value })}
                        className="w-full border border-slate-200 p-2.5 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500"
                        placeholder="例: 岩手県..."
                    />
                </div>

                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-500 mb-1">CPDS番号</label>
                    <input
                        type="text"
                        value={editingWorker.cpdsNumber || ''}
                        onChange={(e) => setEditingWorker({ ...editingWorker, cpdsNumber: e.target.value })}
                        className="w-full border border-slate-200 p-2.5 rounded-lg text-sm font-mono text-slate-700 outline-none focus:border-blue-500"
                        placeholder="例: 12345678901234"
                    />
                </div>

                <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-lg font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition"
                    >キャンセル</button>
                    <button
                        onClick={onSave}
                        className="px-5 py-2.5 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition"
                    >
                        保存する
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkerEditModal;
