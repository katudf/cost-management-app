import React from 'react';
import { ShieldAlert, LogOut, ArrowRight, RefreshCw } from 'lucide-react';
import { STAFF_ROLE } from '../../utils/constants';

// ロールごとの本来の入口（管理者画面を使えないロール向け）
const ROLE_ENTRY = {
    [STAFF_ROLE.WORKER]: { href: '/worker.html', label: '作業日報を開く' },
    [STAFF_ROLE.VIEWER]: { href: '/schedule.html', label: '工程表を開く' },
};

/**
 * 管理者画面に入る権限がないアカウントでログインしたときの画面。
 * 担当者情報（office_staff）が取得できなかった場合もここに来るため、再読み込みも用意する。
 */
const NoPermissionScreen = ({ currentStaff, onSignOut }) => {
    const entry = ROLE_ENTRY[currentStaff?.role];

    return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-sm w-full p-8">
                <div className="flex flex-col items-center mb-6 text-center">
                    <div className="bg-amber-500 text-white rounded-full p-3 mb-3">
                        <ShieldAlert size={24} />
                    </div>
                    <h1 className="text-lg font-bold text-slate-800">管理者画面を利用できません</h1>
                    <p className="text-slate-500 text-sm mt-2">
                        {currentStaff
                            ? 'このアカウントには管理者画面の利用権限がありません。'
                            : '担当者情報を確認できませんでした。管理者に担当者設定を確認してもらうか、再読み込みしてください。'}
                    </p>
                </div>

                <div className="space-y-3">
                    {entry && (
                        <a
                            href={entry.href}
                            className="w-full py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-2"
                        >
                            {entry.label}
                            <ArrowRight size={16} />
                        </a>
                    )}
                    {!currentStaff && (
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="w-full py-2.5 rounded-lg font-bold text-sm border-2 border-slate-200 text-slate-600 hover:bg-slate-50 transition flex items-center justify-center gap-2"
                        >
                            <RefreshCw size={16} />
                            再読み込み
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onSignOut}
                        className="w-full py-2 rounded-lg font-bold text-sm text-slate-500 hover:bg-slate-100 transition flex items-center justify-center gap-1.5"
                    >
                        <LogOut size={14} />
                        ログアウト
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NoPermissionScreen;
