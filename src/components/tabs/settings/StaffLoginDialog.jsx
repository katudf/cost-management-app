import React, { useEffect, useState } from 'react';
import { KeyRound, X, Loader2, Eye, EyeOff, AlertTriangle, User } from 'lucide-react';
import { useToast } from '../../Toast';
import { STAFF_ROLE } from '../../../utils/constants';
import { isValidLoginId, normalizeLoginId, LOGIN_PASSWORD_MIN_LENGTH } from '../../../utils/loginId';

/**
 * 担当者のログイン操作ダイアログ（docs/specs/login-id.md §4.2）。
 *   mode = 'create'   … ID発行（ID＋パスワード）
 *          'assign'   … ID割り当て（移行用。ID＋パスワード任意）
 *          'reset'    … パスワードリセット
 *          'changeId' … ID変更
 * onSubmit({ loginId, password }) は失敗時に throw する。エラーはトーストで知らせ、ダイアログは開いたままにする。
 * 開くたびに新しくマウントされる（親が条件付きで描画する）ので、入力欄の初期値は useState で決める。
 * 作業員のログイン（docs/specs/worker-login.md §4.4）にも使う。staff には { name, login_id } を渡し、
 * ID発行では initialLoginId（フリガナからの候補）を最初から入れておける。
 */
const MODE_CONFIG = {
    create: { title: 'ログインIDの発行', needsId: true, needsPassword: true, submitLabel: '発行する' },
    assign: { title: 'ログインIDの割り当て', needsId: true, needsPassword: false, submitLabel: '割り当てる' },
    reset: { title: 'パスワードのリセット', needsId: false, needsPassword: true, submitLabel: 'リセットする' },
    changeId: { title: 'ログインIDの変更', needsId: true, needsPassword: false, submitLabel: '変更する' },
};

const SHARED_ROLES = [STAFF_ROLE.WORKER, STAFF_ROLE.VIEWER];

const StaffLoginDialog = ({ mode, staff, onClose, onSubmit, initialLoginId = '' }) => {
    const { showToast } = useToast();
    const config = MODE_CONFIG[mode];
    const [loginId, setLoginId] = useState(() => (mode === 'changeId' ? staff?.login_id || '' : initialLoginId));
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!config) return undefined;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && !isSubmitting) onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [config, isSubmitting, onClose]);

    if (!config || !staff) return null;

    // 割り当てではパスワードは任意（入力したときだけ変える）
    const passwordEntered = password.length > 0 || passwordConfirm.length > 0;
    const passwordRequired = config.needsPassword;
    const showPasswordFields = config.needsPassword || mode === 'assign';

    const validate = () => {
        if (config.needsId && !isValidLoginId(loginId)) {
            return 'ログインIDは半角英小文字・数字・「_」「-」の3〜20文字で入力してください';
        }
        if (mode === 'changeId' && normalizeLoginId(loginId) === staff.login_id) {
            return '今と同じログインIDです';
        }
        if (passwordRequired || passwordEntered) {
            if (password.length < LOGIN_PASSWORD_MIN_LENGTH) {
                return `パスワードは${LOGIN_PASSWORD_MIN_LENGTH}文字以上で入力してください`;
            }
            if (password !== passwordConfirm) {
                return '確認用のパスワードが一致しません';
            }
        }
        return '';
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const message = validate();
        if (message) {
            showToast(message, 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            await onSubmit({
                loginId: config.needsId ? normalizeLoginId(loginId) : undefined,
                password: passwordRequired || passwordEntered ? password : undefined,
            });
        } catch (error) {
            console.error('ログイン操作エラー:', error);
            showToast(error.message || '処理に失敗しました', 'error');
            setIsSubmitting(false);
        }
    };

    const willLogOutEverywhere = mode === 'reset' || (mode === 'assign' && passwordEntered);
    const isSharedAccount = SHARED_ROLES.includes(staff.role);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => { if (!isSubmitting) onClose(); }}
        >
            <form
                role="dialog"
                aria-modal="true"
                aria-labelledby="staff-login-dialog-title"
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleSubmit}
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            >
                <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 id="staff-login-dialog-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <KeyRound size={20} className="text-blue-600" /> {config.title}
                        </h3>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            aria-label="閉じる"
                            title="閉じる"
                            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 disabled:opacity-50"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <p className="text-sm text-slate-600">
                        対象: <span className="font-bold text-slate-800">{staff.name}</span>
                        {staff.login_id && mode !== 'changeId' && (
                            <span className="ml-2 font-mono text-slate-500">（{staff.login_id}）</span>
                        )}
                    </p>

                    {mode === 'assign' && (
                        <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                            割り当てた時点で、この人は元のメールアドレス{staff.legacy_email ? `（${staff.legacy_email}）` : ''}ではログインできなくなります。
                            新しいログインIDを本人に伝えてください。パスワードは入力しなければ今のまま使えます。
                        </p>
                    )}

                    {config.needsId && (
                        <div>
                            <label htmlFor="staff-login-id" className="block text-xs font-bold text-slate-500 mb-1">
                                ログインID <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                <input
                                    id="staff-login-id"
                                    type="text"
                                    value={loginId}
                                    onChange={(e) => setLoginId(e.target.value)}
                                    autoComplete="off"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    autoFocus
                                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-slate-200 font-mono font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder="例: tanaka01"
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1">半角英小文字・数字・「_」「-」の3〜20文字（大文字は小文字として扱います）</p>
                        </div>
                    )}

                    {showPasswordFields && (
                        <div className="space-y-2">
                            <label htmlFor="staff-login-password" className="block text-xs font-bold text-slate-500">
                                {mode === 'assign' ? '新しいパスワード（任意）' : <>パスワード <span className="text-red-500">*</span></>}
                            </label>
                            <div className="relative">
                                <input
                                    id="staff-login-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoComplete="new-password"
                                    autoFocus={!config.needsId}
                                    className="w-full px-4 pr-10 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                    placeholder={`${LOGIN_PASSWORD_MIN_LENGTH}文字以上`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                                    title={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={passwordConfirm}
                                onChange={(e) => setPasswordConfirm(e.target.value)}
                                autoComplete="new-password"
                                aria-label="パスワード（確認）"
                                className="w-full px-4 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                                placeholder="確認のためもう一度"
                            />
                        </div>
                    )}

                    {willLogOutEverywhere && (
                        <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                            <span>
                                パスワードを変えると、この人はすべての端末でログアウトされます。
                                {isSharedAccount && ' 共有アカウントのため、現場のすべての端末で新しいパスワードでの再ログインが必要です。'}
                            </span>
                        </p>
                    )}

                </div>

                <div className="bg-slate-50 p-4 flex gap-3 justify-end border-t border-slate-100">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-all border border-slate-200 disabled:opacity-50"
                    >
                        キャンセル
                    </button>
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="px-5 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                        {config.submitLabel}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default StaffLoginDialog;
