import React, { useState } from 'react';
import { KeyRound, Lock, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const ResetPasswordScreen = () => {
    const { updatePassword, cancelPasswordRecovery, signOut } = useAuth();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [isDone, setIsDone] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');

        if (newPassword.length < 6) {
            setErrorMessage('パスワードは6文字以上で入力してください');
            return;
        }
        if (newPassword !== confirmPassword) {
            setErrorMessage('パスワードが一致しません');
            return;
        }

        setIsSubmitting(true);
        try {
            await updatePassword(newPassword);
            setIsDone(true);
        } catch (error) {
            console.error('パスワード更新エラー:', error);
            setErrorMessage('パスワードの更新に失敗しました。時間をおいて再度お試しください');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackToLogin = async () => {
        await signOut();
        cancelPasswordRecovery();
    };

    return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-sm w-full p-8">
                <div className="flex flex-col items-center mb-6">
                    <div className="bg-blue-600 text-white rounded-full p-3 mb-3">
                        <KeyRound size={24} />
                    </div>
                    <h1 className="text-lg font-bold text-slate-800">パスワードの再設定</h1>
                    <p className="text-slate-400 text-sm mt-1">新しいパスワードを設定してください</p>
                </div>

                {isDone ? (
                    <div className="space-y-4">
                        <div className="flex items-start gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg p-3">
                            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                            <span>パスワードを更新しました。改めてログインしてください。</span>
                        </div>
                        <button
                            type="button"
                            onClick={handleBackToLogin}
                            className="w-full py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition"
                        >
                            ログイン画面へ
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">新しいパスワード</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="6文字以上"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">新しいパスワード（確認）</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="もう一度入力"
                                />
                            </div>
                        </div>

                        {errorMessage && (
                            <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span>{errorMessage}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting || !newPassword || !confirmPassword}
                            className="w-full py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-100"
                        >
                            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                            パスワードを更新
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default ResetPasswordScreen;
