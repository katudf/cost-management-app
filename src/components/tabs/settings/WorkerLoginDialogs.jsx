import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, X, Loader2, Link2, Unlink, RefreshCw, PenLine, UserPlus, Ban, Merge } from 'lucide-react';
import { useToast } from '../../Toast';
import { useConfirm } from '../../ConfirmProvider';
import StaffLoginDialog from './StaffLoginDialog';
import { fetchLinkableStaff } from '../../../hooks/useWorkerLogins';
import { suggestLoginId } from '../../../utils/kanaToRomaji';
import { STAFF_ROLE } from '../../../utils/constants';

// 作業員に紐付けられる担当者（共有アカウント・閲覧用は不可。サーバーでも断る。docs/specs/worker-login.md §5）
const LINKABLE_ROLES = [STAFF_ROLE.OFFICE, STAFF_ROLE.ADMIN, STAFF_ROLE.SYSTEM_ADMIN];

const ActionButton = ({ icon: Icon, label, onClick, tone = 'blue' }) => (
    <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 font-bold text-sm transition ${
            tone === 'red'
                ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                : 'border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50'
        }`}
    >
        <Icon size={16} /> {label}
    </button>
);

// 担当者を選ぶダイアログの文言。link: ログインの無い作業員に紐付ける / merge: 作業員の自分のIDを担当者のIDに統合する（§5.2）
const STAFF_PICKER_TEXT = {
    link: {
        icon: Link2,
        title: '担当者のIDを紐付ける',
        description: '担当者と作業員の両方に登録されている人が、1つのログインIDで作業日報も入力できるようにします。共有アカウント・閲覧用アカウントは選べません。',
        submit: '紐付ける',
        failure: '紐付けに失敗しました',
        empty: '紐付けられる担当者がいません（ログインIDのある事務・管理者で、まだ作業員に紐付いていない人）。',
    },
    merge: {
        icon: Merge,
        title: '担当者のIDに統合',
        description: '同じ人の担当者のログインIDに1つにまとめます。作業員のログインIDは削除され、これからは担当者のIDで作業日報も入力します。日報などのデータはそのまま残ります。共有アカウント・閲覧用アカウントは選べません。',
        submit: '統合する',
        failure: '統合に失敗しました',
        empty: '統合先にできる担当者がいません（ログインIDのある事務・管理者で、まだ作業員に紐付いていない人）。',
    },
};

/** 担当者のIDを作業員に紐付ける／統合するダイアログ */
const LinkStaffDialog = ({ worker, variant = 'link', isSystemAdmin, linkedStaffIds, onClose, onSubmit }) => {
    const text = STAFF_PICKER_TEXT[variant];
    const TitleIcon = text.icon;
    const { showToast } = useToast();
    const [staff, setStaff] = useState(null);
    const [selected, setSelected] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        fetchLinkableStaff()
            .then(setStaff)
            .catch((error) => {
                console.error(error);
                showToast('担当者の一覧を取得できませんでした', 'error');
                setStaff([]);
            });
    }, [showToast]);

    const candidates = useMemo(() => (staff || []).filter((s) => s.login_id
        && LINKABLE_ROLES.includes(s.role)
        && !linkedStaffIds.has(s.id)
        // 管理者・システム管理者のログインはシステム管理者だけが紐付けられる
        && (isSystemAdmin || s.role === STAFF_ROLE.OFFICE)), [staff, linkedStaffIds, isSystemAdmin]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selected) {
            showToast('担当者を選んでください', 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            const staffId = Number(selected);
            await onSubmit(staffId, candidates.find((s) => s.id === staffId));
        } catch (error) {
            showToast(error.message || text.failure, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => { if (!isSubmitting) onClose(); }}>
            <form role="dialog" aria-modal="true" aria-labelledby="link-staff-title" onSubmit={handleSubmit}
                onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
                <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 id="link-staff-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <TitleIcon size={20} className="text-blue-600" /> {text.title}
                        </h3>
                        <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="閉じる" title="閉じる"
                            className="p-2 hover:bg-slate-100 rounded-full text-slate-400 disabled:opacity-50">
                            <X size={20} />
                        </button>
                    </div>
                    <p className="text-sm text-slate-600">
                        対象: <span className="font-bold text-slate-800">{worker.name}</span>
                    </p>
                    <p className="text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                        {text.description}
                    </p>
                    {staff === null ? (
                        <div className="flex justify-center py-4"><Loader2 className="animate-spin text-blue-500" /></div>
                    ) : candidates.length === 0 ? (
                        <p className="text-sm text-slate-500">{text.empty}</p>
                    ) : (
                        <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="紐付ける担当者"
                            className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 outline-none focus:border-blue-500">
                            <option value="">担当者を選ぶ</option>
                            {candidates.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}（{s.login_id}）</option>
                            ))}
                        </select>
                    )}
                </div>
                <div className="bg-slate-50 p-4 flex gap-3 justify-end border-t border-slate-100">
                    <button type="button" onClick={onClose} disabled={isSubmitting}
                        className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 border border-slate-200 disabled:opacity-50">
                        キャンセル
                    </button>
                    <button type="submit" disabled={isSubmitting || !candidates.length}
                        className="px-5 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                        {isSubmitting && <Loader2 size={16} className="animate-spin" />} {text.submit}
                    </button>
                </div>
            </form>
        </div>
    );
};

/**
 * 作業員のログイン操作（docs/specs/worker-login.md §4.4）。管理者（admin / system_admin）だけが開く。
 *   未発行   … ID発行 / 担当者のIDを紐付ける
 *   発行済み … パスワードリセット / ID変更 / 担当者のIDに統合（担当者と共有していないとき） / ログイン解除
 *   退職済み … 表示だけ（ログインは止まっている）
 */
const WorkerLoginDialogs = ({ worker, login, loginMap, isSystemAdmin, workerLogins, onLinkedChange, onClose }) => {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [mode, setMode] = useState(null); // null（操作の選択）| 'create' | 'reset' | 'changeId' | 'link' | 'merge'

    // 退職日を入れた時点でログインは止まる（未来の日付でも。決定 #8）
    const resigned = !!worker.resignation_date;
    const linkedStaffIds = useMemo(
        () => new Set([...loginMap.values()].map((l) => l.linked_staff_id).filter(Boolean)),
        [loginMap]);
    const takenIds = useMemo(() => [...loginMap.values()].map((l) => l.login_id).filter(Boolean), [loginMap]);
    const target = { name: worker.name, login_id: login?.login_id || null };

    const finish = async (message) => {
        showToast(message, 'success');
        await workerLogins.refetchLogins();
        onClose();
    };

    const handleUnlink = async () => {
        const ok = await confirm({
            title: 'ログイン解除',
            message: login?.linked_staff_id
                ? `「${worker.name}」と担当者の紐付けを外します。担当者としてのログインはそのまま使えます。`
                : `「${worker.name}」のログインID「${login?.login_id}」を削除します。この人はログインできなくなります。元に戻せません。`,
            confirmText: '解除する',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await workerLogins.unlinkLogin(worker.id);
            onLinkedChange(worker.id, false);
            await finish('ログインを解除しました');
        } catch (error) {
            showToast(error.message || 'ログインの解除に失敗しました', 'error');
        }
    };

    if (mode === 'create' || mode === 'reset' || mode === 'changeId') {
        const submit = async ({ loginId, password }) => {
            if (mode === 'create') {
                await workerLogins.createLogin(worker.id, loginId, password);
                onLinkedChange(worker.id, true);
                await finish(`ログインID「${loginId}」を発行しました。本人に伝えてください`);
            } else if (mode === 'reset') {
                const result = await workerLogins.resetPassword(worker.id, password);
                await finish(result?.logged === false
                    ? 'パスワードをリセットしました（変更履歴の記録には失敗しました）'
                    : 'パスワードをリセットしました。本人はすべての端末でログインし直しになります');
            } else {
                await workerLogins.changeLoginId(worker.id, loginId);
                await finish(`ログインIDを「${loginId}」に変更しました。本人に伝えてください`);
            }
        };
        return (
            <StaffLoginDialog
                mode={mode}
                staff={target}
                onClose={onClose}
                onSubmit={submit}
                initialLoginId={mode === 'create' ? suggestLoginId(worker.kana, takenIds) : ''}
            />
        );
    }

    if (mode === 'link') {
        return (
            <LinkStaffDialog
                worker={worker}
                isSystemAdmin={isSystemAdmin}
                linkedStaffIds={linkedStaffIds}
                onClose={onClose}
                onSubmit={async (staffId) => {
                    await workerLogins.linkStaffAccount(worker.id, staffId);
                    onLinkedChange(worker.id, true);
                    await finish('担当者のログインIDを紐付けました');
                }}
            />
        );
    }

    if (mode === 'merge') {
        return (
            <LinkStaffDialog
                worker={worker}
                variant="merge"
                isSystemAdmin={isSystemAdmin}
                linkedStaffIds={linkedStaffIds}
                onClose={onClose}
                onSubmit={async (staffId, staff) => {
                    const ok = await confirm({
                        title: '担当者のIDに統合',
                        message: `「${worker.name}」の作業員のログインID「${login?.login_id}」を削除し、担当者「${staff?.name}」のログインID「${staff?.login_id}」にまとめます。`
                            + '作業員のIDでログインしている端末はログアウトされるので、本人に担当者のIDで入り直すよう伝えてください。元に戻せません。',
                        confirmText: '統合する',
                        variant: 'danger',
                    });
                    if (!ok) return;
                    try {
                        await workerLogins.mergeIntoStaff(worker.id, staffId);
                    } catch (error) {
                        // 古いログインの削除だけ失敗した場合は、付け替えは済んでいる。一覧を取り直し、統合済みなら
                        // ダイアログを閉じて案内だけ出す（開いたままだと、もう一度押して「既に共有」で断られる）
                        const latest = await workerLogins.refetchLogins();
                        if (latest?.get(worker.id)?.linked_staff_id === staffId) {
                            showToast(error.message || '統合しましたが、古いログインの削除に失敗しました', 'error');
                            onClose();
                            return;
                        }
                        throw error;
                    }
                    await finish(`担当者のログインID「${staff?.login_id}」に統合しました。本人に伝えてください`);
                }}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-labelledby="worker-login-title" onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 id="worker-login-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <KeyRound size={20} className="text-blue-600" /> ログイン
                    </h3>
                    <button type="button" onClick={onClose} aria-label="閉じる" title="閉じる"
                        className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                        <X size={20} />
                    </button>
                </div>
                <div className="text-sm text-slate-600 space-y-1">
                    <div>対象: <span className="font-bold text-slate-800">{worker.name}</span></div>
                    <div>
                        ログインID: {login?.login_id
                            ? <span className="font-mono font-bold text-slate-800">{login.login_id}</span>
                            : <span className="text-slate-400">未発行</span>}
                        {login?.linked_staff_id && <span className="ml-2 text-xs font-bold text-blue-700">（担当者と共有）</span>}
                    </div>
                </div>

                {resigned ? (
                    <p className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                        <Ban size={14} className="shrink-0 mt-0.5" />
                        <span>退職日が入っているため、ログインは止まっています。退職日を消すと再開します。</span>
                    </p>
                ) : login ? (
                    <div className="space-y-2">
                        <ActionButton icon={RefreshCw} label="パスワードリセット" onClick={() => setMode('reset')} />
                        <ActionButton icon={PenLine} label="ID変更" onClick={() => setMode('changeId')} />
                        {/* 自分のIDを持つ作業員だけ（担当者と共有済みなら統合するものが無い） */}
                        {!login.linked_staff_id && (
                            <ActionButton icon={Merge} label="担当者のIDに統合" onClick={() => setMode('merge')} />
                        )}
                        <ActionButton icon={Unlink} label="ログイン解除" onClick={handleUnlink} tone="red" />
                    </div>
                ) : (
                    <div className="space-y-2">
                        <ActionButton icon={UserPlus} label="ID発行" onClick={() => setMode('create')} />
                        <ActionButton icon={Link2} label="担当者のIDを紐付ける" onClick={() => setMode('link')} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkerLoginDialogs;
