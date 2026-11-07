import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit3, Trash2, Save, X, User, Shield, UserCheck, Loader2, Mail, KeyRound, AtSign, PencilLine } from 'lucide-react';
import { useToast } from '../../components/Toast';
import ConfirmModal from '../ConfirmModal';
import { STAFF_ROLE, STAFF_ROLE_LABEL, STAFF_ROLE_LIST, isDisplayableStaff, isAdminRole } from '../../utils/constants';
import { useStaffSettingsData } from '../../hooks/useStaffSettingsData';
import { useAuth } from '../../hooks/useAuth';
import { canManageStaffLogin } from '../../utils/loginId';
import StaffLoginDialog from './settings/StaffLoginDialog';
import OwnPasswordChange from './settings/OwnPasswordChange';

const StaffSettings = () => {
    const { showToast } = useToast();
    const { currentStaff, refreshCurrentStaff } = useAuth();
    const isAdmin = isAdminRole(currentStaff?.role);
    const isSystemAdmin = currentStaff?.role === STAFF_ROLE.SYSTEM_ADMIN;
    const {
        staffList, isLoading, refetch, createStaff, updateStaff, deleteStaff,
        createLogin, assignLoginId, resetPassword, changeLoginId,
    } = useStaffSettingsData();
    const [isSaving, setIsSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [form, setForm] = useState({ id: null, name: '', role: STAFF_ROLE.WORKER, is_approver: false });
    const [confirmDeleteStaff, setConfirmDeleteStaff] = useState(null);
    // ログイン操作ダイアログ: { mode: 'create' | 'assign' | 'reset' | 'changeId', staff }
    const [loginDialog, setLoginDialog] = useState(null);

    // 管理者の任命・解任はシステム管理者だけ（決定 #11）。業務管理者には「管理者」を選ばせない。
    const roleOptions = isSystemAdmin ? STAFF_ROLE_LIST : STAFF_ROLE_LIST.filter(role => role !== STAFF_ROLE.ADMIN);
    // 業務管理者が管理者の行を編集するときは権限区分を変えられない（名前・承認者は従来どおり）
    const isRoleLocked = !isAdmin || (!isSystemAdmin && form.role === STAFF_ROLE.ADMIN && !!form.id);

    useEffect(() => {
        refetch().catch((error) => {
            console.error('担当者情報取得エラー:', error);
            showToast('担当者情報の取得に失敗しました', 'error');
        });
    }, [refetch, showToast]);

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
                await updateStaff(form.id, payload);
                showToast('担当者情報を更新しました', 'success');
                // 自分の行を変えたときは、ヘッダーの名前や管理者かどうかの判定に反映させる
                if (form.id === currentStaff?.id) {
                    refreshCurrentStaff().catch((error) => {
                        console.error('ログイン中の担当者情報の再取得エラー:', error);
                        showToast('変更を画面に反映できませんでした。ページを再読み込みしてください', 'error');
                    });
                }
            } else {
                await createStaff(payload);
                showToast('担当者情報を追加しました', 'success');
            }

            setForm({ id: null, name: '', role: STAFF_ROLE.WORKER, is_approver: false });
            refetch();
        } catch (error) {
            console.error('担当者情報保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (staff) => {
        setIsSaving(true);
        try {
            await deleteStaff(staff);
            showToast('担当者情報を削除しました', 'success');
            refetch();
        } catch (error) {
            console.error('担当者情報削除エラー:', error);
            showToast(`削除に失敗しました: ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLoginSubmit = async ({ loginId, password }) => {
        const { mode, staff } = loginDialog;
        let result;
        if (mode === 'create') {
            result = await createLogin(staff.id, loginId, password);
            showToast(`ログインID「${loginId}」を発行しました。本人にIDとパスワードを伝えてください`, 'success');
        } else if (mode === 'assign') {
            result = await assignLoginId(staff.id, loginId, password);
            showToast(`ログインID「${loginId}」を割り当てました。本人に新しいIDを伝えてください`, 'success');
        } else if (mode === 'reset') {
            result = await resetPassword(staff.id, password);
            showToast('パスワードをリセットしました。本人に新しいパスワードを伝えてください', 'success');
        } else if (mode === 'changeId') {
            result = await changeLoginId(staff.id, loginId);
            showToast(`ログインIDを「${loginId}」に変更しました。本人に伝えてください`, 'success');
        }
        if (result?.logged === false) {
            showToast('パスワード変更履歴への記録に失敗しました', 'error');
        }
        setLoginDialog(null);
        refetch().catch((error) => console.error('担当者情報取得エラー:', error));
    };

    // システム管理者の行は、システム管理者がログインしているときだけ出す（自分のID割り当て・リセットのため）
    const filteredStaff = staffList.filter(s => isSystemAdmin || isDisplayableStaff(s)).filter(s =>
        s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (STAFF_ROLE_LABEL[s.role] || s.role || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.login_id || '').includes(searchQuery.toLowerCase()) ||
        (s.legacy_email || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    // 削除できるのは、ログインを操作できる行（admin は office / worker / viewer、system_admin は全員）の、自分以外
    const canDeleteStaff = (staff) => canManageStaffLogin(currentStaff?.role, staff.role) && staff.id !== currentStaff?.id;
    const deleteDisabledReason = (staff) => {
        if (!isAdmin) return '削除には管理者権限が必要です';
        if (staff.id === currentStaff?.id) return '自分自身は削除できません';
        return '管理者・システム管理者はシステム管理者だけが削除できます';
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <OwnPasswordChange />
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <UserCheck className="text-blue-500" />
                        担当者・関係者管理
                    </h3>
                </div>

                {/* 入力フォーム（新規追加は管理者のみ。管理者以外は自分の行の編集時だけ表示） */}
                {(isAdmin || form.id) && (
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
                                    disabled={isRoleLocked}
                                    title={!isAdmin ? '権限区分の変更には管理者権限が必要です' : isRoleLocked ? '管理者の権限区分はシステム管理者だけが変更できます' : undefined}
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition appearance-none bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                >
                                    {(isRoleLocked || form.role === STAFF_ROLE.SYSTEM_ADMIN ? [form.role] : roleOptions).map(role => (
                                        <option key={role} value={role}>{STAFF_ROLE_LABEL[role] || role}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                    <label
                        className={`mt-4 inline-flex items-center gap-2 select-none ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                        title={isAdmin ? undefined : '承認者の変更には管理者権限が必要です'}
                    >
                        <input
                            type="checkbox"
                            checked={form.is_approver}
                            onChange={(e) => setForm({ ...form, is_approver: e.target.checked })}
                            disabled={!isAdmin}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
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
                )}

                {/* 検索バー */}
                <div className="mb-4 relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="名前・役職・ログインIDで検索..."
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
                                            <StaffLoginCell
                                                staff={staff}
                                                isAdmin={isAdmin}
                                                canManage={canManageStaffLogin(currentStaff?.role, staff.role)}
                                                disabled={isSaving}
                                                onOpen={(mode) => setLoginDialog({ mode, staff })}
                                            />
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                {(isAdmin || staff.id === currentStaff?.id) && (
                                                    <button
                                                        onClick={() => setForm({ ...staff })}
                                                        disabled={isSaving}
                                                        className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                                        aria-label="編集"
                                                        title="編集"
                                                    >
                                                        <Edit3 size={16} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setConfirmDeleteStaff(staff)}
                                                    disabled={isSaving || !canDeleteStaff(staff)}
                                                    aria-label={canDeleteStaff(staff) ? '削除' : '削除（権限なし）'}
                                                    title={canDeleteStaff(staff) ? '削除' : deleteDisabledReason(staff)}
                                                    className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50 disabled:hover:text-red-500 disabled:hover:border-slate-200 disabled:cursor-not-allowed"
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
                isOpen={!!confirmDeleteStaff}
                onClose={() => setConfirmDeleteStaff(null)}
                onConfirm={() => { handleDelete(confirmDeleteStaff); setConfirmDeleteStaff(null); }}
                title="担当者情報を削除"
                message={confirmDeleteStaff?.auth_user_id
                    ? 'この担当者情報とログインを削除してもよろしいですか？この人はログインできなくなります。過去の見積等の担当者名が消える場合があります。'
                    : 'この担当者情報を削除してもよろしいですか？過去の見積等の担当者名が消える場合があります。'}
            />
            {loginDialog && (
                <StaffLoginDialog
                    mode={loginDialog.mode}
                    staff={loginDialog.staff}
                    onClose={() => setLoginDialog(null)}
                    onSubmit={handleLoginSubmit}
                />
            )}
        </div>
    );
};

/**
 * 一覧の「ログイン」列。行の状態ごとに表示とボタンを出し分ける（docs/specs/login-id.md §4.2）。
 *   ログインなし              → 「ID発行」
 *   ログインあり・ID未割り当て → 移行前のメールアドレスと「ID割り当て」
 *   ID割り当て済み            → ID と「パスワードリセット」「ID変更」
 * 管理者以外には RPC がIDを返さないので、ログインの有無だけを出す。
 */
const StaffLoginCell = ({ staff, isAdmin, canManage, disabled, onOpen }) => {
    const actionButtonClass = 'inline-flex items-center gap-1.5 text-slate-500 hover:text-blue-600 text-xs font-bold border border-slate-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition disabled:opacity-50';
    const iconButtonClass = 'text-slate-400 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 transition disabled:opacity-50';

    if (!staff.auth_user_id) {
        if (!canManage) return <span className="text-slate-400 text-xs font-bold">未発行</span>;
        return (
            <button onClick={() => onOpen('create')} disabled={disabled} className={actionButtonClass}>
                <KeyRound size={14} /> ID発行
            </button>
        );
    }

    if (!isAdmin) {
        return <span className="text-green-600 text-xs font-bold">ログインあり</span>;
    }

    if (!staff.login_id) {
        return (
            <div className="flex flex-col items-start gap-1">
                <span className="text-amber-600 text-xs font-bold bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">ID未割り当て</span>
                {staff.legacy_email && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 font-medium break-all" title={staff.legacy_email}>
                        <Mail size={12} className="shrink-0" /> {staff.legacy_email}
                    </span>
                )}
                {canManage && (
                    <button onClick={() => onOpen('assign')} disabled={disabled} className={actionButtonClass}>
                        <AtSign size={14} /> ID割り当て
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1">
            <span className="font-mono text-sm text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">{staff.login_id}</span>
            {canManage && (
                <>
                    <button
                        onClick={() => onOpen('reset')}
                        disabled={disabled}
                        aria-label="パスワードをリセット"
                        title="パスワードをリセット"
                        className={iconButtonClass}
                    >
                        <KeyRound size={16} />
                    </button>
                    <button
                        onClick={() => onOpen('changeId')}
                        disabled={disabled}
                        aria-label="ログインIDを変更"
                        title="ログインIDを変更"
                        className={iconButtonClass}
                    >
                        <PencilLine size={16} />
                    </button>
                </>
            )}
        </div>
    );
};

export default StaffSettings;
