import React, { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Edit3, Trash2, Save, X, User, Shield, UserCheck, Loader2, Mail, Send, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import ConfirmModal from '../ConfirmModal';
import { STAFF_ROLE, STAFF_ROLE_LABEL, STAFF_ROLE_LIST } from '../../utils/constants';

const StaffSettings = () => {
    const { showToast } = useToast();
    const [staffList, setStaffList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [form, setForm] = useState({ id: null, name: '', role: STAFF_ROLE.WORKER, is_approver: false });
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [inviteTargetId, setInviteTargetId] = useState(null);
    const [inviteEmail, setInviteEmail] = useState('');
    const [isInviting, setIsInviting] = useState(false);

    const fetchStaff = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('office_staff')
                .select('*')
                .order('name', { ascending: true });
            
            if (error) throw error;
            setStaffList(data || []);
        } catch (error) {
            console.error('担当者情報取得エラー:', error);
            showToast('担当者情報の取得に失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchStaff();
    }, [fetchStaff]);

    const handleSave = async () => {
        if (!form.name.trim()) {
            showToast('担当者名は必須です', 'error');
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                role: form.role,
                is_approver: form.is_approver,
            };

            if (form.id) {
                const { error } = await supabase.from('office_staff').update(payload).eq('id', form.id);
                if (error) throw error;
                showToast('担当者情報を更新しました', 'success');
            } else {
                const { error } = await supabase.from('office_staff').insert([payload]);
                if (error) throw error;
                showToast('担当者情報を追加しました', 'success');
            }

            setForm({ id: null, name: '', role: STAFF_ROLE.WORKER, is_approver: false });
            fetchStaff();
        } catch (error) {
            console.error('担当者情報保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        setIsSaving(true);
        try {
            const { error } = await supabase.from('office_staff').delete().eq('id', id);
            if (error) throw error;
            showToast('担当者情報を削除しました', 'success');
            fetchStaff();
        } catch (error) {
            console.error('担当者情報削除エラー:', error);
            showToast('削除に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleInvite = async () => {
        if (!inviteEmail.trim() || !inviteTargetId) return;

        setIsInviting(true);
        try {
            const { error } = await supabase.functions.invoke('invite-staff', {
                body: { staffId: inviteTargetId, email: inviteEmail.trim() },
            });
            if (error) throw error;

            showToast('招待メールを送信しました', 'success');
            setInviteTargetId(null);
            setInviteEmail('');
            fetchStaff();
        } catch (error) {
            console.error('招待エラー:', error);
            showToast('招待の送信に失敗しました', 'error');
        } finally {
            setIsInviting(false);
        }
    };

    const filteredStaff = staffList.filter(s =>
        s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (STAFF_ROLE_LABEL[s.role] || s.role || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <UserCheck className="text-blue-500" />
                        担当者・関係者管理
                    </h3>
                </div>

                {/* 入力フォーム */}
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 mb-8 shadow-sm">
                    <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                        {form.id ? <Edit3 size={18} className="text-blue-600" /> : <Plus size={18} className="text-green-600" />}
                        {form.id ? '担当者情報の編集' : '新規担当者の追加'}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">担当者名 <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="山田 太郎"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">権限区分 <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                                <select
                                    value={form.role}
                                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition appearance-none bg-white"
                                >
                                    {STAFF_ROLE_LIST.map(role => (
                                        <option key={role} value={role}>{STAFF_ROLE_LABEL[role]}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                    <label className="mt-4 inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={form.is_approver}
                            onChange={(e) => setForm({ ...form, is_approver: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-bold text-slate-600">見積の承認者にする</span>
                    </label>
                    <div className="flex justify-end gap-3 mt-5">
                        {form.id && (
                            <button
                                onClick={() => setForm({ id: null, name: '', role: STAFF_ROLE.WORKER, is_approver: false })}
                                disabled={isSaving}
                                className="px-5 py-2.5 rounded-lg font-bold text-sm text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 transition flex items-center gap-1 disabled:opacity-50"
                            >
                                <X size={16} /> キャンセル
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={!form.name || isSaving}
                            className="px-5 py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-100"
                        >
                            <Save size={16} /> {form.id ? '更新する' : '追加する'}
                        </button>
                    </div>
                </div>

                {/* 検索バー */}
                <div className="mb-4 relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="名前や役職で検索..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:border-blue-400 focus:bg-white outline-none font-bold text-slate-700 transition-all"
                    />
                </div>

                {/* 一覧テーブル */}
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left font-bold text-slate-700">
                        <thead>
                            <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wider">
                                <th className="p-4 font-bold border-b border-slate-200 w-1/4">担当者名</th>
                                <th className="p-4 font-bold border-b border-slate-200">権限区分</th>
                                <th className="p-4 font-bold border-b border-slate-200 w-28 text-center">承認者</th>
                                <th className="p-4 font-bold border-b border-slate-200 w-64">ログイン</th>
                                <th className="p-4 font-bold border-b border-slate-200 text-center w-32">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {isLoading ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400">
                                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                        読み込み中...
                                    </td>
                                </tr>
                            ) : filteredStaff.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400 font-bold text-sm">
                                        担当者情報がありません
                                    </td>
                                </tr>
                            ) : (
                                filteredStaff.map(staff => (
                                    <tr key={staff.id} className={`hover:bg-slate-50 transition ${form.id === staff.id ? 'bg-blue-50' : ''}`}>
                                        <td className="p-4 text-sm text-slate-800">{staff.name}</td>
                                        <td className="p-4 text-sm text-slate-500">{STAFF_ROLE_LABEL[staff.role] || staff.role || '-'}</td>
                                        <td className="p-4 text-center">
                                            {staff.is_approver ? (
                                                <span className="inline-flex items-center gap-1 text-blue-600 text-xs font-bold bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                                                    <Shield size={12} /> 承認可
                                                </span>
                                            ) : (
                                                <span className="text-slate-300 text-xs font-bold">-</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-sm">
                                            {staff.auth_user_id ? (
                                                <span className="inline-flex items-center gap-1.5 text-green-600 text-xs font-bold bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                                                    <CheckCircle2 size={14} /> 招待済み
                                                </span>
                                            ) : inviteTargetId === staff.id ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="relative">
                                                        <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                                                        <input
                                                            type="email"
                                                            value={inviteEmail}
                                                            onChange={(e) => setInviteEmail(e.target.value)}
                                                            placeholder="you@example.com"
                                                            autoFocus
                                                            className="pl-8 pr-2 py-1.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 text-xs outline-none focus:border-blue-500 transition w-40"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={handleInvite}
                                                        disabled={!inviteEmail.trim() || isInviting}
                                                        aria-label="招待メールを送信"
                                                        title="招待メールを送信"
                                                        className="text-blue-600 hover:text-blue-700 disabled:opacity-50 p-1.5 rounded-lg hover:bg-blue-50 transition"
                                                    >
                                                        {isInviting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                                    </button>
                                                    <button
                                                        onClick={() => { setInviteTargetId(null); setInviteEmail(''); }}
                                                        disabled={isInviting}
                                                        aria-label="招待をキャンセル"
                                                        title="キャンセル"
                                                        className="text-slate-400 hover:text-slate-600 disabled:opacity-50 p-1.5 rounded-lg hover:bg-slate-100 transition"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => { setInviteTargetId(staff.id); setInviteEmail(''); }}
                                                    className="inline-flex items-center gap-1.5 text-slate-500 hover:text-blue-600 text-xs font-bold border border-slate-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition"
                                                >
                                                    <Mail size={14} /> 招待する
                                                </button>
                                            )}
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => setForm({ ...staff })}
                                                    disabled={isSaving}
                                                    className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                    title="編集"
                                                >
                                                    <Edit3 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDeleteId(staff.id)}
                                                    disabled={isSaving}
                                                    className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                    title="削除"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            <ConfirmModal
                isOpen={!!confirmDeleteId}
                onClose={() => setConfirmDeleteId(null)}
                onConfirm={() => { handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                title="担当者情報を削除"
                message="この担当者情報を削除してもよろしいですか？過去の見積等の担当者名が消える場合があります。"
            />
        </div>
    );
};

export default StaffSettings;
