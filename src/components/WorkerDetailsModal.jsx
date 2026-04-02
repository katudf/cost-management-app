import React from 'react';
import { User, Edit3, Trash2 } from 'lucide-react';
import { calculateAge } from '../utils/dateUtils';

const WorkerDetailsModal = ({ isOpen, worker, onClose, onEdit, onDelete }) => {
    if (!isOpen || !worker) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center justify-between border-b pb-3">
                    <div className="flex items-center gap-2">
                        <User className="text-blue-500" />
                        作業員詳細情報
                    </div>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">氏名</label>
                        <div className="w-full border-2 border-transparent p-2.5 rounded-lg font-bold text-lg text-slate-800 bg-slate-50">
                            {worker.name || '未設定'}
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">ふりがな</label>
                        <div className="w-full border border-transparent p-2.5 rounded-lg text-sm text-slate-700 bg-slate-50">
                            {worker.kana || '未設定'}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">生年月日</label>
                        <div className="w-full border border-transparent p-2.5 rounded-lg text-sm text-slate-700 bg-slate-50">
                            {worker.birthDate ? `${worker.birthDate.replace(/-/g, '/')} (${calculateAge(worker.birthDate)}歳)` : '未設定'}
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">入社日</label>
                        <div className="w-full border border-transparent p-2.5 rounded-lg text-sm text-slate-700 bg-slate-50">
                            {worker.hireDate ? worker.hireDate.replace(/-/g, '/') : '未設定'}
                        </div>
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">連絡先 (電話番号等)</label>
                    <div className="w-full border border-transparent p-2.5 rounded-lg text-sm text-slate-700 bg-slate-50">
                        {worker.contactInfo || '未設定'}
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">住所</label>
                    <div className="w-full border border-transparent p-2.5 rounded-lg text-sm text-slate-700 bg-slate-50">
                        {worker.address || '未設定'}
                    </div>
                </div>

                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-500 mb-1">CPDS番号</label>
                    <div className="w-full border border-transparent p-2.5 rounded-lg text-sm font-mono text-slate-700 bg-slate-50">
                        {worker.cpdsNumber || '未設定'}
                    </div>
                </div>

                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-500 mb-2">保有資格</label>
                    <div className="flex flex-col gap-2">
                        {worker.certifications && worker.certifications.length > 0 ? (
                            worker.certifications.map(cert => (
                                <div key={cert.id} className="bg-slate-50 border border-slate-200 p-3 rounded-lg flex flex-col gap-1">
                                    <div className="flex justify-between items-start">
                                        <div className="font-bold text-slate-800 text-sm">{cert.name}</div>
                                        {cert.registrationNumber && (
                                            <div className="text-xs bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-500 font-mono">
                                                {cert.registrationNumber}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-xs text-slate-500 flex justify-end gap-3 mt-1">
                                        {cert.acquisitionDate && <span>取得: {cert.acquisitionDate.replace(/-/g, '/')}</span>}
                                        {cert.expiryDate && <span>期限: {cert.expiryDate.replace(/-/g, '/')}</span>}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-sm text-slate-400 bg-slate-50 border border-transparent p-3 rounded-lg text-center">登録されている資格情報はありません</div>
                        )}
                    </div>
                </div>

                <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-lg font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition"
                    >
                        閉じる
                    </button>
                    <button
                        onClick={() => { onClose(); onEdit(worker); }}
                        className="px-5 py-2.5 flex items-center gap-1 rounded-lg font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 transition border border-blue-200"
                    >
                        <Edit3 size={18} /> 編集する
                    </button>
                    <button
                        onClick={() => { onClose(); onDelete(worker.id, worker.name); }}
                        className="px-5 py-2.5 flex items-center gap-1 rounded-lg font-bold text-red-500 bg-red-50 hover:bg-red-100 transition border border-red-200"
                    >
                        <Trash2 size={18} /> 削除する
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkerDetailsModal;
