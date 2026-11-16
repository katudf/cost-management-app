import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarOff, ChevronDown, Loader2, AlertCircle, WifiOff } from 'lucide-react';
import { useToast } from '../Toast';
import { useConfirm } from '../ConfirmProvider';
import { fetchWorkerDayLeave, fetchSubstituteHolidayCandidates, saveWorkerDayLeave } from '../../hooks/useWorkerLeave';
import {
    LEAVE_KIND, LEAVE_PART, LEAVE_PART_LABEL,
    parseLeaveTitle, validateLeaveEntries, leaveFormToEntries, leaveRowsToForm, isSameLeaveEntries,
    getLeaveConflictWarnings, formatShortDateWithDow,
} from '../../utils/leaveUtils';
import { describeSaveError } from '../../utils/dailyReportSave';

const MODES = [
    { value: 'none', label: 'なし' },
    { value: 'full', label: '終日' },
    { value: 'half', label: '半日' },
];

const remainingLabel = (remaining) => (remaining >= 1 ? '残り1日' : '残り半日');

/**
 * 日報画面の「この日の休み」欄。有給・振休（終日／午前／午後）を配置表に記録する。
 * - 保存はこの欄のボタンで行い、日報の送信とは別（オンライン時だけ）。
 * - 振休は振替元（休業日に日報がある日）を候補から選ぶ。1 つの振替元は合計 1 日分まで。
 * - 休みと作業実績が食い違うときは警告だけ出す（保存は止めない）。
 *
 * @param {object} props
 * @param {{ id: number, name: string }} props.worker 入力する作業員（代理入力中はその作業員）
 * @param {string} props.date 'YYYY-MM-DD'
 * @param {boolean} props.isOnline
 * @param {Array} props.records その日の作業実績（全現場の TaskRecords）
 */
const DayLeaveSection = ({ worker, date, isOnline, records }) => {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [savedRows, setSavedRows] = useState([]);
    const [form, setForm] = useState(() => leaveRowsToForm([]));
    const [candidates, setCandidates] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    // 読み込み済みの対象（作業員・日付）。保存や候補の取得の応答が、切り替え後の別の日に反映されないようにする
    const [loadedKey, setLoadedKey] = useState(null);
    const [candidatesKey, setCandidatesKey] = useState(null);
    const currentKeyRef = useRef('');

    const workerId = worker?.id;
    const workerName = worker?.name;
    const targetKey = workerId && workerName && date ? `${workerId}|${workerName}|${date}` : '';
    currentKeyRef.current = targetKey;

    // 作業員・日付が変わったら空に戻す（オフラインになっても保存済みの表示は消さない）。
    // effect だと読み込みの effect が古い状態で一度走って二重に取得するため、描画中に戻す
    const resetToken = `${targetKey}#${reloadKey}`;
    const [appliedResetToken, setAppliedResetToken] = useState(resetToken);
    if (appliedResetToken !== resetToken) {
        setAppliedResetToken(resetToken);
        setSavedRows([]);
        setForm(leaveRowsToForm([]));
        setCandidates([]);
        setLoadedKey(null);
        setCandidatesKey(null);
        setLoadFailed(false);
        setIsExpanded(false);
    }

    // その日の休みの行（オンラインで、まだ読んでいないときだけ）
    useEffect(() => {
        if (!targetKey || !isOnline || loadedKey === targetKey || loadFailed) return undefined;
        let active = true;
        setIsLoading(true);
        fetchWorkerDayLeave(workerId, date).then(rows => {
            if (!active) return;
            setSavedRows(rows);
            setForm(leaveRowsToForm(rows));
            setLoadedKey(targetKey);
            setIsExpanded(rows.length > 0);
        }).catch(error => {
            console.error('Day leave load error:', error);
            if (active) setLoadFailed(true);
        }).finally(() => { if (active) setIsLoading(false); });
        return () => { active = false; };
    }, [targetKey, isOnline, loadedKey, loadFailed]);

    // 振替元の候補は欄を開いているときだけ取る
    useEffect(() => {
        if (!targetKey || !isOnline || !isExpanded || loadedKey !== targetKey || candidatesKey === targetKey) return undefined;
        let active = true;
        fetchSubstituteHolidayCandidates({ id: workerId, name: workerName }, date).then(cands => {
            if (!active) return;
            setCandidates(cands);
            setCandidatesKey(targetKey);
        }).catch(error => {
            console.error('Substitute candidates load error:', error);
            if (active) setLoadFailed(true);
        });
        return () => { active = false; };
    }, [targetKey, isOnline, isExpanded, loadedKey, candidatesKey]);

    const entries = useMemo(() => leaveFormToEntries(form), [form]);
    const isChanged = !isSameLeaveEntries(entries, savedRows);
    const validationError = useMemo(() => {
        const base = validateLeaveEntries(entries);
        if (base) return base;
        // 同じ振替元を午前・午後の両方に使うなど、残りを超える選び方
        const usage = {};
        entries.forEach(e => {
            if (!e.substitute_for_date) return;
            usage[e.substitute_for_date] = (usage[e.substitute_for_date] || 0) + parseLeaveTitle(e.title).weight;
        });
        const over = Object.entries(usage).find(([d, w]) => {
            const c = candidates.find(x => x.work_date === d);
            return c && w > c.remaining;
        });
        return over ? `振替元 ${formatShortDateWithDow(over[0])} は${remainingLabel(candidates.find(x => x.work_date === over[0]).remaining)}です。` : null;
    }, [entries, candidates]);
    const conflictWarnings = useMemo(() => getLeaveConflictWarnings(entries, records), [entries, records]);

    const savedSummary = savedRows.length > 0 ? savedRows.map(r => r.title).join('・') : 'なし';

    const setMode = (mode) => setForm(prev => ({ ...prev, mode }));
    const setSlot = (part, patch) => setForm(prev => ({ ...prev, [part]: { ...prev[part], ...patch } }));

    const handleSave = async () => {
        if (!isOnline || isSaving || validationError || !isChanged) return;
        if (entries.length === 0) {
            const ok = await confirm({
                title: '休みの取り消し',
                message: `${formatShortDateWithDow(date)} の休み（${savedSummary}）を取り消します。配置表からも消えます。よろしいですか？`,
                confirmText: '取り消す',
            });
            if (!ok) return;
        }
        setIsSaving(true);
        const savingKey = targetKey;
        try {
            const rows = await saveWorkerDayLeave({ id: workerId, name: workerName }, date, entries);
            showToast(rows.length > 0 ? `休み（${rows.map(r => r.title).join('・')}）を保存しました` : '休みを取り消しました', 'success');
            // 保存中に作業員・日付が切り替わっていたら、今の欄には反映しない（切り替え先は読み直される）
            if (currentKeyRef.current !== savingKey) return;
            setSavedRows(rows);
            setForm(leaveRowsToForm(rows));
            // 振替元の残りが変わるので候補を取り直す
            setCandidatesKey(null);
        } catch (error) {
            console.error('Day leave save error:', error);
            showToast(describeSaveError(error, { action: '休みを保存' }), 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const renderKindButtons = (part) => {
        const slot = form[part];
        const options = part === LEAVE_PART.FULL
            ? [LEAVE_KIND.PAID, LEAVE_KIND.SUBSTITUTE]
            : ['', LEAVE_KIND.PAID, LEAVE_KIND.SUBSTITUTE];
        return (
            <div className="flex gap-1.5" role="radiogroup" aria-label={`${LEAVE_PART_LABEL[part]}の休みの種別`}>
                {options.map(kind => {
                    const active = slot.kind === kind;
                    return (
                        <button key={kind || 'none'} type="button" role="radio" aria-checked={active}
                            onClick={() => setSlot(part, { kind })}
                            className={`flex-1 h-10 rounded-lg text-sm font-bold border transition active:scale-95 ${active
                                ? 'bg-amber-500 text-white border-amber-500'
                                : 'bg-white text-slate-600 border-slate-200'}`}>
                            {kind || '出勤'}
                        </button>
                    );
                })}
            </div>
        );
    };

    const renderSubstituteSelect = (part) => {
        const slot = form[part];
        if (slot.kind !== LEAVE_KIND.SUBSTITUTE) return null;
        const hasCurrent = slot.substituteForDate && !candidates.some(c => c.work_date === slot.substituteForDate);
        return (
            <div className="mt-1.5">
                <select value={slot.substituteForDate || ''}
                    onChange={(e) => setSlot(part, { substituteForDate: e.target.value })}
                    aria-label={`${LEAVE_PART_LABEL[part]}の振休の振替元`}
                    className="w-full h-10 bg-white border-2 border-indigo-200 text-slate-800 px-2 rounded-lg font-bold text-sm outline-none focus:border-indigo-500">
                    <option value="">振替元（休日に出勤した日）を選ぶ...</option>
                    {hasCurrent && (
                        <option value={slot.substituteForDate}>{formatShortDateWithDow(slot.substituteForDate)}（候補外）</option>
                    )}
                    {candidates.map(c => (
                        <option key={c.work_date} value={c.work_date}>
                            {formatShortDateWithDow(c.work_date)} {remainingLabel(c.remaining)}
                        </option>
                    ))}
                </select>
                {candidates.length === 0 && (
                    <div className="text-[11px] font-bold text-slate-400 mt-1">
                        振替元の候補がありません（日曜・会社の休日に日報を入れた日が候補になります）
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-2">
            <button type="button" onClick={() => setIsExpanded(v => !v)} aria-expanded={isExpanded}
                className="w-full px-4 py-3 flex items-center gap-2 text-left">
                <CalendarOff className="shrink-0 w-5 h-5 text-amber-500" />
                <span className="font-bold text-sm text-slate-700">この日の休み（有給・振休）</span>
                <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${savedRows.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                    {isLoading ? '読み込み中' : loadedKey === targetKey ? savedSummary : (isOnline ? '―' : '未確認')}
                </span>
                <ChevronDown className={`shrink-0 w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            {isExpanded && (
                <div className="px-4 pb-4 flex flex-col gap-3 border-t border-slate-100 pt-3">
                    {!isOnline ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            <WifiOff size={14} className="shrink-0" /> オフライン中は休みの確認・保存ができません。電波の良いところで開き直してください。
                        </div>
                    ) : isLoading ? (
                        <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 text-amber-500 animate-spin" /></div>
                    ) : loadFailed ? (
                        <div className="flex items-center justify-between gap-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <span>休みを読み込めませんでした。</span>
                            <button type="button" onClick={() => setReloadKey(k => k + 1)}
                                className="px-2 py-1 rounded-md bg-white border border-red-200">再読み込み</button>
                        </div>
                    ) : (
                        <>
                            <div className="flex gap-1.5" role="radiogroup" aria-label="休みの取り方">
                                {MODES.map(m => (
                                    <button key={m.value} type="button" role="radio" aria-checked={form.mode === m.value}
                                        onClick={() => setMode(m.value)}
                                        className={`flex-1 h-10 rounded-lg text-sm font-bold border transition active:scale-95 ${form.mode === m.value
                                            ? 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white text-slate-600 border-slate-200'}`}>
                                        {m.label}
                                    </button>
                                ))}
                            </div>

                            {form.mode === 'full' && (
                                <div>
                                    {renderKindButtons(LEAVE_PART.FULL)}
                                    {renderSubstituteSelect(LEAVE_PART.FULL)}
                                </div>
                            )}

                            {form.mode === 'half' && [LEAVE_PART.AM, LEAVE_PART.PM].map(part => (
                                <div key={part}>
                                    <div className="text-xs font-bold text-slate-500 mb-1">
                                        {LEAVE_PART_LABEL[part]}（{part === LEAVE_PART.AM ? '〜12:00' : '13:00〜'}）
                                    </div>
                                    {renderKindButtons(part)}
                                    {renderSubstituteSelect(part)}
                                </div>
                            ))}

                            {conflictWarnings.length > 0 && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex flex-col gap-1">
                                    {conflictWarnings.map(w => (
                                        <div key={w} className="flex items-start gap-1.5 text-[11px] font-bold text-amber-700">
                                            <AlertCircle size={12} className="shrink-0 mt-0.5" /> {w}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {isChanged && validationError && (
                                <div className="text-[11px] font-bold text-red-600">{validationError}</div>
                            )}

                            <button type="button" onClick={handleSave}
                                disabled={!isChanged || !!validationError || isSaving}
                                className="h-11 rounded-xl font-bold text-sm text-white bg-amber-500 disabled:bg-slate-200 disabled:text-slate-400 flex items-center justify-center gap-2 active:scale-95 transition">
                                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {entries.length === 0 && savedRows.length > 0 ? '休みを取り消す' : '休みを保存'}
                            </button>
                            <div className="text-[10px] text-slate-400 leading-snug">
                                保存すると配置表に反映されます（日報の送信とは別に保存されます）。
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default DayLeaveSection;
