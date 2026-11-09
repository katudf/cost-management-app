import React from 'react';
import { ShieldAlert, LogOut, RefreshCw } from 'lucide-react';

const DEFAULT_MESSAGE = 'このログインIDでは利用できません。退職などでログインが止められている場合や、IDが違う場合は管理者に連絡してください。';

/**
 * 作業日報・在庫管理を使えないときの画面（docs/specs/worker-login.md §4.2 / §4.3）。
 * 既定の文言は、閲覧用の共有アカウント、退職した作業員、どこにも紐付いていないログインのとき。
 * message で文言を差し替えられる（初めてのオフライン起動で本人が分からないときなど）。
 * onRetry を渡すと「再読み込み」ボタンを出す。
 */
const WorkerNoAccessScreen = ({ title, onSignOut, onRetry, message = DEFAULT_MESSAGE, accentClass = 'border-blue-600' }) => (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center p-4">
        <div className={`w-full max-w-sm mt-10 bg-white rounded-2xl shadow-lg p-6 text-center border-t-4 ${accentClass}`}>
            <ShieldAlert className="w-14 h-14 text-amber-500 mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-xl font-black text-slate-800 mb-2">{title}</h1>
            <p className="text-sm text-slate-600 mb-6">{message}</p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition mb-3"
                >
                    <RefreshCw size={18} /> 再読み込み
                </button>
            )}
            <button
                onClick={onSignOut}
                className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-800 text-white font-bold py-3 rounded-xl transition"
            >
                <LogOut size={18} /> ログアウト
            </button>
        </div>
    </div>
);

export default WorkerNoAccessScreen;
