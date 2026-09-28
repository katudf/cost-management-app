import React, { useState, useEffect, useCallback } from 'react';
import { Share2, Copy, RefreshCw, Ban, ExternalLink } from 'lucide-react';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmProvider';
import {
    fetchShareToken,
    regenerateShareToken,
    disableShare,
    buildShareUrl,
} from '../../../features/scheduleShare/scheduleShareApi';

/**
 * 配置表のログイン不要共有（共有キー付きURL）の発行・再発行・停止
 */
export default function ScheduleShareSettings() {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [token, setToken] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setToken(await fetchShareToken());
        } catch (e) {
            console.error(e);
            showToast('共有設定の読み込みに失敗しました', 'error');
        } finally {
            setLoaded(true);
        }
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const shareUrl = token ? buildShareUrl(token) : '';

    const handleIssue = async () => {
        if (token) {
            const ok = await confirm({
                title: '共有URLの再発行',
                message: '新しいURLを発行すると、現在の共有URLは使えなくなります。配布済みの相手には新しいURLを再度共有してください。よろしいですか？',
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            setToken(await regenerateShareToken());
            showToast(token ? '共有URLを再発行しました' : '共有URLを発行しました');
        } catch (e) {
            console.error(e);
            showToast('共有URLの発行に失敗しました', 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleDisable = async () => {
        const ok = await confirm({
            title: '共有の停止',
            message: '共有を停止すると、現在の共有URLでは配置表を閲覧できなくなります。よろしいですか？',
        });
        if (!ok) return;
        setBusy(true);
        try {
            await disableShare();
            setToken(null);
            showToast('共有を停止しました');
        } catch (e) {
            console.error(e);
            showToast('共有の停止に失敗しました', 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            showToast('URLをコピーしました');
        } catch (e) {
            console.error(e);
            showToast('コピーに失敗しました。URLを選択して手動でコピーしてください', 'error');
        }
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-3xl">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Share2 className="text-blue-500" />
                        配置表の共有URL
                    </h3>
                    <p className="text-xs text-slate-400">ログイン無しで配置表を閲覧できます</p>
                </div>

                <p className="text-sm text-slate-600 mb-4">
                    このURLを知っている人は誰でも、ログイン無しで配置表（作業員名・現場名・日程）を閲覧できます。
                    編集はできません。社外に広まった場合は「再発行」または「停止」で旧URLを無効化してください。
                </p>

                {!loaded ? (
                    <p className="text-sm text-slate-400">読み込み中...</p>
                ) : token ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                readOnly
                                value={shareUrl}
                                onFocus={(e) => e.target.select()}
                                className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono bg-slate-50 text-slate-700"
                                aria-label="共有URL"
                            />
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="p-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition"
                                aria-label="URLをコピー"
                                title="URLをコピー"
                            >
                                <Copy size={18} />
                            </button>
                            <a
                                href={shareUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition"
                                aria-label="共有URLを開く"
                                title="共有URLを開く"
                            >
                                <ExternalLink size={18} />
                            </a>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handleIssue}
                                disabled={busy}
                                className="bg-white text-slate-700 border border-slate-300 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <RefreshCw size={16} /> URLを再発行
                            </button>
                            <button
                                type="button"
                                onClick={handleDisable}
                                disabled={busy}
                                className="bg-white text-red-600 border border-red-200 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Ban size={16} /> 共有を停止
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-500">現在、共有URLは発行されていません（共有停止中）。</p>
                        <button
                            type="button"
                            onClick={handleIssue}
                            disabled={busy}
                            className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Share2 size={18} /> 共有URLを発行
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
