import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Save, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmProvider';
import {
    fetchLineWorksEnabled,
    saveLineWorksEnabled,
    fetchWorkerLineWorksIds,
    saveWorkerLineWorksId,
    sendLineWorksNotification,
} from '../../../features/lineworks/lineworksNotify';

const LineWorksSettings = () => {
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const [enabled, setEnabled] = useState(false);
    const [workers, setWorkers] = useState([]);
    // 入力中の値は workerId をキーにしたローカル状態で保持する（保存時にDBへ反映）
    const [draftIds, setDraftIds] = useState({});
    const [loaded, setLoaded] = useState(false);
    const [savingIds, setSavingIds] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);

    const load = useCallback(async () => {
        try {
            const [isEnabled, workerRows] = await Promise.all([
                fetchLineWorksEnabled(),
                fetchWorkerLineWorksIds(),
            ]);
            setEnabled(isEnabled);
            setWorkers(workerRows);
            setDraftIds(
                Object.fromEntries(workerRows.map(w => [w.id, w.lineworks_user_id || '']))
            );
        } catch (e) {
            console.error('LINE WORKS設定の取得エラー:', e);
            showToast('LINE WORKS設定の取得に失敗しました: ' + e.message, 'error');
        } finally {
            setLoaded(true);
        }
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const handleToggleEnabled = async (next) => {
        setEnabled(next);
        try {
            await saveLineWorksEnabled(next);
            showToast(next ? 'LINE WORKS通知を有効にしました' : 'LINE WORKS通知を無効にしました', 'success');
        } catch (e) {
            console.error('LINE WORKS有効設定の保存エラー:', e);
            setEnabled(!next);
            showToast('設定の保存に失敗しました: ' + e.message, 'error');
        }
    };

    // 変更のあった作業員だけをまとめて保存する
    const handleSaveIds = async () => {
        const changed = workers.filter(
            w => (draftIds[w.id] ?? '').trim() !== (w.lineworks_user_id || '')
        );
        if (changed.length === 0) {
            showToast('変更はありません', 'info');
            return;
        }

        setSavingIds(true);
        try {
            for (const w of changed) {
                await saveWorkerLineWorksId(w.id, draftIds[w.id]);
            }
            setWorkers(prev => prev.map(w => (
                changed.some(c => c.id === w.id)
                    ? { ...w, lineworks_user_id: (draftIds[w.id] ?? '').trim() || null }
                    : w
            )));
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
            showToast(`${changed.length}件の LINE WORKS ID を保存しました`, 'success');
        } catch (e) {
            console.error('LINE WORKS ID保存エラー:', e);
            showToast('保存に失敗しました: ' + e.message, 'error');
        } finally {
            setSavingIds(false);
        }
    };

    const targetCount = workers.filter(w => (draftIds[w.id] ?? '').trim()).length;

    const handleSend = async () => {
        if (!message.trim()) {
            showToast('メッセージを入力してください', 'error');
            return;
        }
        const ok = await confirm({
            title: 'LINE WORKS 通知の送信',
            message: `LINE WORKS ID が設定された作業員 ${targetCount} 名にメッセージを送信します。よろしいですか？`,
        });
        if (!ok) return;

        setSending(true);
        try {
            const result = await sendLineWorksNotification(message);
            if (result?.failedCount > 0) {
                const names = (result.failed || []).map(f => f.name).join('、');
                showToast(
                    `${result.sentCount}件送信しました。${result.failedCount}件失敗（${names}）`,
                    'error'
                );
            } else {
                showToast(`${result?.sentCount ?? 0}件のメッセージを送信しました`, 'success');
                setMessage('');
            }
        } catch (e) {
            console.error('LINE WORKS送信エラー:', e);
            showToast('送信に失敗しました: ' + e.message, 'error');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            {/* 有効/無効 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-3xl">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <MessageSquare className="text-blue-500" />
                        LINE WORKS 通知
                    </h3>
                    <p className="text-xs text-slate-400">Bot から作業員へ一斉送信します</p>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => handleToggleEnabled(e.target.checked)}
                        className="w-5 h-5 accent-blue-600"
                    />
                    <span className="text-sm font-bold text-slate-700">LINE WORKS 通知を有効にする</span>
                </label>

                <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 leading-relaxed">
                        認証情報（Client ID / Client Secret / Service Account / 秘密鍵 / Bot ID）は
                        Supabase Edge Functions の Secrets で管理します。この画面には入力しません。
                    </p>
                </div>
            </div>

            {/* 作業員のLINE WORKS ID */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-3xl">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-base font-bold text-slate-800">作業員の LINE WORKS ID</h3>
                    <span className="text-xs text-slate-400">送信対象: {targetCount} 名</span>
                </div>
                <p className="text-xs text-slate-400 mb-5">
                    LINE WORKS のユーザーIDまたはメールアドレスを入力します。空欄の作業員は送信対象外です。
                </p>

                {!loaded ? (
                    <div className="text-center text-slate-400 py-8">読み込み中...</div>
                ) : workers.length === 0 ? (
                    <div className="text-center text-slate-400 py-8">在籍中の作業員がいません</div>
                ) : (
                    <>
                        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                            {workers.map(w => (
                                <div key={w.id} className="flex items-center gap-3">
                                    <span className="w-28 shrink-0 text-sm font-bold text-slate-700 truncate" title={w.name}>
                                        {w.name}
                                    </span>
                                    <input
                                        type="text"
                                        value={draftIds[w.id] ?? ''}
                                        onChange={e => setDraftIds(prev => ({ ...prev, [w.id]: e.target.value }))}
                                        className="flex-1 border-2 border-slate-200 p-2 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition"
                                        placeholder="例: taro@example.com"
                                        aria-label={`${w.name} の LINE WORKS ID`}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="flex items-center gap-4 pt-6 mt-6 border-t border-slate-100">
                            <button
                                onClick={handleSaveIds}
                                disabled={savingIds}
                                className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={18} />
                                {savingIds ? '保存中...' : 'LINE WORKS ID を保存'}
                            </button>
                            {saveSuccess && (
                                <span className="text-green-600 font-bold text-sm flex items-center gap-1">
                                    <CheckCircle2 size={18} /> 保存完了
                                </span>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* テスト送信 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-3xl">
                <h3 className="text-base font-bold text-slate-800 mb-2">メッセージ送信</h3>
                <p className="text-xs text-slate-400 mb-5">
                    LINE WORKS ID を設定した在籍中の作業員全員へ、Bot からテキストを送信します。
                </p>

                <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={5}
                    maxLength={1000}
                    className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition resize-y"
                    placeholder="例: 明日の朝礼は 7:30 からです。現場に直行してください。"
                />
                <div className="text-right text-xs text-slate-400 mt-1">{message.length} / 1000</div>

                <div className="pt-4">
                    <button
                        onClick={handleSend}
                        disabled={sending || !enabled || !message.trim() || targetCount === 0}
                        className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Send size={18} />
                        {sending ? '送信中...' : '送信する'}
                    </button>
                    {!enabled && (
                        <p className="text-xs text-slate-400 mt-2">送信するには上の「LINE WORKS 通知を有効にする」をONにしてください。</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(LineWorksSettings);
