import React, { useState } from 'react';
import { Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { CONTRACT_TYPE, CONTRACT_TYPE_LIST } from '../../utils/constants';
import { countReclassifiedRecords } from '../../utils/projectUtils';
import { useConfirm } from '../ConfirmProvider';
import { useToast } from '../Toast';

const EMPTY_FORM = {
    subcontractor_id: '',
    type: CONTRACT_TYPE.UKEOI,
    unit_price: '',
    contract_amount: '',
    scope: '',
    start_date: '',
    end_date: '',
};

const inputClass = 'border border-orange-200 rounded p-1 text-xs font-bold outline-none focus:border-orange-400 bg-white';

/**
 * 現場ごとの協力業者契約（常用／請負）。docs/specs/subcontractors.md §5.2
 *   常用: 人工 × 単価。日報の人数から原価を計算する
 *   請負: 契約金額を登録時に全額計上する。期間（開始日〜終了日）内の人数は原価に入れない（終了日が空なら継続中）
 * 日報から自動作成された暫定の常用契約には「要確認」を出し、単価を確定すると、単価 0 の記録にも反映される。
 */
const SubcontractContractsPanel = ({ activeProject, subcontractorOps }) => {
    const { confirm } = useConfirm();
    const { showToast } = useToast();
    const { subcontractors, addContract, updateContract, deleteContract, confirmContract } = subcontractorOps;
    const contracts = activeProject.subcontractContracts || [];
    const records = activeProject.subcontractors || [];
    const [form, setForm] = useState(EMPTY_FORM);
    const [confirmPrices, setConfirmPrices] = useState({});

    const nameOf = (id) => subcontractors.find(s => s.id === id)?.name || `会社 #${id}`;
    const activeCompanies = subcontractors.filter(s => s.active);
    const isUkeoi = form.type === CONTRACT_TYPE.UKEOI;

    const handleAdd = async () => {
        if (!form.subcontractor_id) {
            showToast('会社を選んでください', 'error');
            return;
        }
        if (isUkeoi && (form.contract_amount === '' || !form.start_date)) {
            showToast('請負は、契約金額と開始日を入力してください', 'error');
            return;
        }
        if (!isUkeoi && form.unit_price === '') {
            showToast('常用は、単価を入力してください', 'error');
            return;
        }
        const fields = isUkeoi
            ? {
                subcontractor_id: Number(form.subcontractor_id),
                type: CONTRACT_TYPE.UKEOI,
                contract_amount: Number(form.contract_amount),
                scope: form.scope.trim() || null,
                start_date: form.start_date,
                end_date: form.end_date || null,
            }
            : {
                subcontractor_id: Number(form.subcontractor_id),
                type: CONTRACT_TYPE.JOYO,
                unit_price: Number(form.unit_price),
            };
        if (await addContract(activeProject.id, fields)) setForm(EMPTY_FORM);
    };

    // 請負の期間・金額などの編集。期間が変わって請負 ↔ 常用の扱いが変わる記録があれば、先に確認する
    const handleUpdate = async (contract, patch) => {
        const next = { ...contract, ...patch };
        if (contract.type === CONTRACT_TYPE.UKEOI && ('start_date' in patch || 'end_date' in patch)) {
            if (!next.start_date) {
                showToast('請負の開始日は必須です', 'error');
                return;
            }
            const others = contracts.filter(c => c.id !== contract.id);
            const n = countReclassifiedRecords(records, contracts, [...others, next]);
            if (n > 0) {
                const ok = await confirm({
                    title: '請負の期間を変更',
                    message: `${n} 件の協力業者の記録の扱い（請負 ↔ 常用）が変わります。原価が変わりますが、よろしいですか？`,
                    confirmText: '変更する',
                });
                if (!ok) return;
            }
        }
        await updateContract(contract, patch);
    };

    const handleDelete = async (contract) => {
        const others = contracts.filter(c => c.id !== contract.id);
        const n = countReclassifiedRecords(records, contracts, others);
        const ok = await confirm({
            title: '契約の削除',
            message: `${nameOf(contract.subcontractor_id)} の${contract.type}契約を削除しますか？`
                + (n > 0 ? `\n${n} 件の記録が請負から常用の扱いに変わり、原価が増えます。` : ''),
            confirmText: '削除する',
            variant: 'danger',
        });
        if (!ok) return;
        await deleteContract(contract);
    };

    const handleConfirm = async (contract) => {
        const raw = confirmPrices[contract.id] ?? contract.unit_price ?? 0;
        const price = Number(raw);
        if (!(price >= 0)) {
            showToast('単価を正しく入力してください', 'error');
            return;
        }
        const count = await confirmContract(contract, price);
        if (count !== null) showToast(`単価を確定しました（${count} 件の記録に反映）`, 'success');
    };

    return (
        <div className="mb-10">
            <h2 className="text-lg font-bold text-orange-600 mb-1">協力業者の契約</h2>
            <p className="text-xs text-slate-500 mb-4">
                常用は「人数 × 単価」、請負は「契約金額」を原価に計上します。請負の期間内の人数は原価に入りません（終了日が空の間は継続中）。
            </p>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto mb-4">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-orange-50 border-b border-orange-200 text-orange-800 font-bold">
                        <tr>
                            <th className="p-3 text-[11px] tracking-wider">会社</th>
                            <th className="p-3 text-[11px] tracking-wider">契約形態</th>
                            <th className="p-3 text-[11px] tracking-wider">単価 / 契約金額（円）</th>
                            <th className="p-3 text-[11px] tracking-wider">工事内容</th>
                            <th className="p-3 text-[11px] tracking-wider">期間</th>
                            <th className="p-3 text-[11px] tracking-wider">状態</th>
                            <th className="p-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {contracts.map(c => {
                            const unpriced = c.type === CONTRACT_TYPE.JOYO && c.needs_review && Number(c.unit_price || 0) === 0;
                            return (
                                <tr key={c.id} className="border-b last:border-0 align-top">
                                    <td className="p-2 font-bold">{nameOf(c.subcontractor_id)}</td>
                                    <td className="p-2">
                                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${c.type === CONTRACT_TYPE.UKEOI ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}`}>
                                            {c.type}
                                        </span>
                                    </td>
                                    <td className="p-2">
                                        {c.type === CONTRACT_TYPE.UKEOI ? (
                                            <input
                                                key={`${c.id}-amount-${c.contract_amount}`}
                                                type="number"
                                                min="0"
                                                defaultValue={c.contract_amount ?? ''}
                                                aria-label="契約金額"
                                                className={`${inputClass} w-32 text-right`}
                                                onBlur={(e) => {
                                                    const v = e.target.value === '' ? null : Number(e.target.value);
                                                    if (v !== null && v !== Number(c.contract_amount)) handleUpdate(c, { contract_amount: v });
                                                }}
                                            />
                                        ) : c.needs_review ? (
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={confirmPrices[c.id] ?? c.unit_price ?? 0}
                                                    aria-label="単価（確定前）"
                                                    className={`${inputClass} w-28 text-right`}
                                                    onChange={(e) => setConfirmPrices(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                />
                                                <button
                                                    onClick={() => handleConfirm(c)}
                                                    className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-green-700"
                                                    aria-label="この単価で契約を確定"
                                                    title="この単価で確定し、単価 0 の記録にも反映します"
                                                >
                                                    <CheckCircle2 size={14} /> 確定
                                                </button>
                                            </div>
                                        ) : (
                                            <input
                                                key={`${c.id}-price-${c.unit_price}`}
                                                type="number"
                                                min="0"
                                                defaultValue={c.unit_price ?? 0}
                                                aria-label="単価"
                                                className={`${inputClass} w-28 text-right`}
                                                onBlur={(e) => {
                                                    const v = Number(e.target.value);
                                                    if (e.target.value !== '' && v !== Number(c.unit_price)) handleUpdate(c, { unit_price: v });
                                                }}
                                            />
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {c.type === CONTRACT_TYPE.UKEOI ? (
                                            <input
                                                key={`${c.id}-scope-${c.scope}`}
                                                type="text"
                                                defaultValue={c.scope || ''}
                                                placeholder="工事内容"
                                                aria-label="工事内容"
                                                className={`${inputClass} w-44`}
                                                onBlur={(e) => {
                                                    if ((e.target.value || null) !== (c.scope || null)) handleUpdate(c, { scope: e.target.value.trim() || null });
                                                }}
                                            />
                                        ) : <span className="text-slate-300">-</span>}
                                    </td>
                                    <td className="p-2">
                                        {c.type === CONTRACT_TYPE.UKEOI ? (
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="date"
                                                    value={c.start_date || ''}
                                                    aria-label="請負の開始日"
                                                    className={inputClass}
                                                    onChange={(e) => e.target.value && handleUpdate(c, { start_date: e.target.value })}
                                                />
                                                <span>〜</span>
                                                <input
                                                    type="date"
                                                    value={c.end_date || ''}
                                                    aria-label="請負の終了日（空なら継続中）"
                                                    className={inputClass}
                                                    onChange={(e) => handleUpdate(c, { end_date: e.target.value || null })}
                                                />
                                            </div>
                                        ) : <span className="text-slate-300">-</span>}
                                    </td>
                                    <td className="p-2 space-x-1">
                                        {c.type === CONTRACT_TYPE.UKEOI && !c.end_date && (
                                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-700">継続中</span>
                                        )}
                                        {c.needs_review && (
                                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-yellow-100 text-yellow-800">要確認</span>
                                        )}
                                        {unpriced && (
                                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700 inline-flex items-center gap-0.5">
                                                <AlertTriangle size={11} /> 単価未設定
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2 text-center">
                                        <button
                                            onClick={() => handleDelete(c)}
                                            aria-label="契約を削除"
                                            title="契約を削除"
                                            className="text-orange-300 hover:text-red-500 transition"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {contracts.length === 0 && (
                            <tr>
                                <td colSpan="7" className="p-8 text-center text-slate-400 font-bold">
                                    契約はまだありません。日報に協力業者の人数が入ると、常用の暫定契約が自動で作られます。
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="bg-orange-50/50 border border-orange-100 rounded-xl p-3 flex flex-wrap items-end gap-3">
                <label className="text-xs font-bold text-slate-600">
                    会社
                    <select
                        value={form.subcontractor_id}
                        onChange={(e) => setForm(f => ({ ...f, subcontractor_id: e.target.value }))}
                        className={`${inputClass} block mt-1 w-48`}
                    >
                        <option value="">選択してください</option>
                        {activeCompanies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </label>
                <label className="text-xs font-bold text-slate-600">
                    契約形態
                    <select
                        value={form.type}
                        onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                        className={`${inputClass} block mt-1`}
                    >
                        {CONTRACT_TYPE_LIST.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </label>
                {isUkeoi ? (
                    <>
                        <label className="text-xs font-bold text-slate-600">
                            契約金額（円）
                            <input type="number" min="0" value={form.contract_amount}
                                onChange={(e) => setForm(f => ({ ...f, contract_amount: e.target.value }))}
                                className={`${inputClass} block mt-1 w-32 text-right`} />
                        </label>
                        <label className="text-xs font-bold text-slate-600">
                            工事内容
                            <input type="text" value={form.scope}
                                onChange={(e) => setForm(f => ({ ...f, scope: e.target.value }))}
                                className={`${inputClass} block mt-1 w-44`} />
                        </label>
                        <label className="text-xs font-bold text-slate-600">
                            開始日
                            <input type="date" value={form.start_date}
                                onChange={(e) => setForm(f => ({ ...f, start_date: e.target.value }))}
                                className={`${inputClass} block mt-1`} />
                        </label>
                        <label className="text-xs font-bold text-slate-600">
                            終了日（完了後に入力）
                            <input type="date" value={form.end_date}
                                onChange={(e) => setForm(f => ({ ...f, end_date: e.target.value }))}
                                className={`${inputClass} block mt-1`} />
                        </label>
                    </>
                ) : (
                    <label className="text-xs font-bold text-slate-600">
                        単価（円/人工）
                        <input type="number" min="0" value={form.unit_price}
                            onChange={(e) => setForm(f => ({ ...f, unit_price: e.target.value }))}
                            className={`${inputClass} block mt-1 w-28 text-right`} />
                    </label>
                )}
                <button
                    onClick={handleAdd}
                    className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition hover:bg-orange-700 shadow-md"
                >
                    <Plus size={16} /> 契約を追加
                </button>
            </div>
        </div>
    );
};

export default SubcontractContractsPanel;
