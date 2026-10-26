import React, { useCallback, useEffect } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useToast } from '../../../components/Toast';
import { usePasswordChangeLogs, MAX_LOGS } from '../../../hooks/usePasswordChangeLogs';
import { parseUserAgent } from '../../../utils/userAgent';
import { PASSWORD_CHANGE_KIND_LABEL } from '../../../utils/constants';

/**
 * パスワード変更履歴（システム管理者のみ表示）。
 * 利用者がパスワードを変更した日時・端末・IP を新しい順に一覧表示する。
 */
export const PasswordChangeLogs = ({ onViewed }) => {
    const { showToast } = useToast();
    const { logs, loading, reload, markAllRead } = usePasswordChangeLogs();

    // 一覧を取得できたら表示した分までを既読にし、親（ナビの未読バッジ）へ知らせる
    const load = useCallback(async () => {
        try {
            const rows = await reload();
            await markAllRead(rows[0]?.created_at);
            onViewed?.();
        } catch (e) {
            console.error(e);
            showToast('パスワード変更履歴の取得に失敗しました: ' + e.message, 'error');
        }
    }, [reload, markAllRead, onViewed, showToast]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <KeyRound size={20} className="text-blue-600" /> パスワード変更履歴
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        利用者がパスワードを再設定した日時と端末です（新しい順。未読がなければ最大{MAX_LOGS}件）。招待からの初回設定は記録されません。
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    aria-label="再読み込み"
                    title="再読み込み"
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {loading && logs.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">読み込み中...</p>
            ) : logs.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">パスワード変更の記録はありません。</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-slate-500">
                                <th className="py-2 pr-4 font-bold whitespace-nowrap">日時</th>
                                <th className="py-2 pr-4 font-bold whitespace-nowrap">担当者</th>
                                <th className="py-2 pr-4 font-bold whitespace-nowrap">メール</th>
                                <th className="py-2 pr-4 font-bold whitespace-nowrap">種別</th>
                                <th className="py-2 pr-4 font-bold whitespace-nowrap">端末</th>
                                <th className="py-2 font-bold whitespace-nowrap">IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map(log => {
                                const { os, browser } = parseUserAgent(log.user_agent);
                                return (
                                    <tr key={log.id} className="border-b border-slate-100">
                                        <td className="py-2 pr-4 whitespace-nowrap">{new Date(log.created_at).toLocaleString('ja-JP')}</td>
                                        <td className="py-2 pr-4 whitespace-nowrap">{log.staff_name || '-'}</td>
                                        <td className="py-2 pr-4">{log.email || '-'}</td>
                                        <td className="py-2 pr-4 whitespace-nowrap">{PASSWORD_CHANGE_KIND_LABEL[log.kind] || log.kind}</td>
                                        <td className="py-2 pr-4 whitespace-nowrap" title={log.user_agent || ''}>{os} / {browser}</td>
                                        <td
                                            className="py-2 whitespace-nowrap font-mono text-xs"
                                            title={log.forwarded_for ? `X-Forwarded-For: ${log.forwarded_for}` : ''}
                                        >
                                            {log.ip_address || '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {logs.length >= MAX_LOGS && (
                        <p className="text-xs text-slate-500 mt-2">これより古い記録は表示していません。</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default PasswordChangeLogs;
