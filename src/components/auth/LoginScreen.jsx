import React, { useState } from 'react';
import { LogIn, Mail, Lock, Loader2, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const LoginScreen = () => {
    const { signIn, resetPasswordForEmail } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const [mode, setMode] = useState('login'); // 'login' | 'reset'
    const [resetEmail, setResetEmail] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [resetError, setResetError] = useState('');
    const [resetSent, setResetSent] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email.trim() || !password) return;

        setIsSubmitting(true);
        setErrorMessage('');
        try {
            await signIn(email.trim(), password);
        } catch (error) {
            console.error('ログインエラー:', error);
            setErrorMessage('メールアドレスまたはパスワードが正しくありません');
        } finally {
            setIsSubmitting(false);
        }
    };

    const openResetMode = () => {
        setResetEmail(email);
        setResetError('');
        setResetSent(false);
        setMode('reset');
    };

    const backToLogin = () => {
        setMode('login');
        setResetError('');
        setResetSent(false);
    };

    const handleResetSubmit = async (e) => {
        e.preventDefault();
        if (!resetEmail.trim()) return;

        setIsResetting(true);
        setResetError('');
        try {
            await resetPasswordForEmail(resetEmail.trim());
            setResetSent(true);
        } catch (error) {
            console.error('パスワード再設定メール送信エラー:', error);
            setResetError('送信に失敗しました。時間をおいて再度お試しください');
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-sm w-full p-8">
                <div className="flex flex-col items-center mb-6">
                    <div className="bg-blue-600 text-white rounded-full p-3 mb-3">
                        <LogIn size={24} />
                    </div>
                    <h1 className="text-lg font-bold text-slate-800">工事原価管理システム</h1>
                    <p className="text-slate-400 text-sm mt-1">{mode === 'login' ? '管理者ログイン' : 'パスワード再設定'}</p>
                </div>

                {mode === 'login' ? (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">メールアドレス</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="username"
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-xs font-bold text-slate-500">パスワード</label>
                                <button
                                    type="button"
                                    onClick={openResetMode}
                                    className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline"
                                >
                                    パスワードをお忘れですか？
                                </button>
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="••••••••"
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
                            disabled={isSubmitting || !email.trim() || !password}
                            className="w-full py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-100"
                        >
                            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                            ログイン
                        </button>
                    </form>
                ) : (
                    <div className="space-y-4">
                        {resetSent ? (
                            <div className="flex items-start gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg p-3">
                                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                                <span>パスワード再設定用のメールを送信しました。メール内のリンクから新しいパスワードを設定してください。</span>
                            </div>
                        ) : (
                            <form onSubmit={handleResetSubmit} className="space-y-4">
                                <p className="text-sm text-slate-500">登録済みのメールアドレスを入力してください。パスワード再設定用のリンクを送信します。</p>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">メールアドレス</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                        <input
                                            type="email"
                                            value={resetEmail}
                                            onChange={(e) => setResetEmail(e.target.value)}
                                            required
                                            autoComplete="username"
                                            className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                            placeholder="you@example.com"
                                        />
                                    </div>
                                </div>

                                {resetError && (
                                    <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                        <span>{resetError}</span>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isResetting || !resetEmail.trim()}
                                    className="w-full py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-100"
                                >
                                    {isResetting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                    再設定メールを送信
                                </button>
                            </form>
                        )}

                        <button
                            type="button"
                            onClick={backToLogin}
                            className="w-full py-2 rounded-lg font-bold text-sm text-slate-500 hover:bg-slate-100 transition flex items-center justify-center gap-1.5"
                        >
                            <ArrowLeft size={14} />
                            ログイン画面に戻る
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LoginScreen;
