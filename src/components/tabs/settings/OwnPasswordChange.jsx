import React, { useEffect, useState } from 'react';
import { Lock, Loader2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useToast } from '../../Toast';
import { useAuth } from '../../../hooks/useAuth';
import { fetchMyLoginId } from '../../../hooks/useStaffSettingsData';
import { LOGIN_PASSWORD_MIN_LENGTH } from '../../../utils/loginId';

/**
 * ログイン中の本人によるパスワード変更（docs/specs/login-id.md §4.3）。
 * 担当者設定（管理者・事務が開ける画面）に置く。作業員・閲覧者の共有アカウントはこの画面に入れない。
 */
const OwnPasswordChange = () => {
    const { showToast } = useToast();
    const { changeOwnPassword } = useAuth();
    const [myLoginId, setMyLoginId] = useState(null);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        fetchMyLoginId()
            .then(setMyLoginId)
            .catch((error) => console.warn('ログインIDの取得に失敗しました:', error));
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!currentPassword) {
            showToast('現在のパスワードを入力してください', 'error');
            return;
        }
        if (newPassword.length < LOGIN_PASSWORD_MIN_LENGTH) {
            showToast(`新しいパスワードは${LOGIN_PASSWORD_MIN_LENGTH}文字以上で入力してください`, 'error');
            return;
        }
        if (newPassword !== newPasswordConfirm) {
            showToast('確認用のパスワードが一致しません', 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            const { logged } = await changeOwnPassword(currentPassword, newPassword);
            setCurrentPassword('');
            setNewPassword('');
            setNewPasswordConfirm('');
            showToast(
                logged
                    ? 'パスワードを変更しました。他の端末ではログアウトされます'
                    : 'パスワードを変更しました（変更履歴への記録には失敗しました）',
                'success',
            );
        } catch (error) {
            console.error('パスワード変更エラー:', error);
            showToast(error.message || 'パスワードの変更に失敗しました', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const inputClass = 'w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition';

    return (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
                <KeyRound size={18} className="text-blue-500" /> 自分のパスワード変更
            </h3>
            <p className="text-xs text-slate-500 mb-4">
                {myLoginId
                    ? <>ログインID: <span className="font-mono font-bold text-slate-700">{myLoginId}</span></>
                    : 'まだログインIDが割り当てられていません（メールアドレスでログイン中）'}
            </p>
            {/* パスワード管理ソフトが「どのアカウントのパスワードか」を判定できるよう、IDを見えない入力欄で渡す。
                hidden 属性や display:none だと判定に使われないことがあるため、sr-only で見た目だけ隠す */}
            <input
                type="text"
                name="username"
                autoComplete="username"
                value={myLoginId || ''}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                        aria-label="現在のパスワード"
                        placeholder="現在のパスワード"
                        className={inputClass}
                    />
                </div>
                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        aria-label="新しいパスワード"
                        placeholder={`新しいパスワード（${LOGIN_PASSWORD_MIN_LENGTH}文字以上）`}
                        className={inputClass}
                    />
                </div>
                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPasswordConfirm}
                        onChange={(e) => setNewPasswordConfirm(e.target.value)}
                        autoComplete="new-password"
                        aria-label="新しいパスワード（確認）"
                        placeholder="新しいパスワード（確認）"
                        className={inputClass}
                    />
                </div>
            </div>
            <div className="flex items-center justify-between mt-4">
                <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
                >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    {showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                </button>
                <button
                    type="submit"
                    disabled={isSubmitting || !currentPassword || !newPassword || !newPasswordConfirm}
                    className="px-5 py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                    変更する
                </button>
            </div>
        </form>
    );
};

export default OwnPasswordChange;
