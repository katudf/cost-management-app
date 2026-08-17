import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus, Edit3, Trash2, X, Save, Loader2, Layers, ChevronDown, ChevronUp, ArrowUp, ArrowDown } from 'lucide-react';
import { useToast } from '../../Toast';
import ConfirmModal from '../../ConfirmModal';
import {
    fetchCoatingSystems,
    fetchPaintProducts,
    createCoatingSystem,
    updateCoatingSystem,
    deleteCoatingSystem,
    saveCoatingSystemSteps,
} from '../../../features/paint/supabasePaint';

const emptyForm = { id: null, name: '', target_use: '', description: '' };

const CoatingSystemsPanel = ({ masters }) => {
    const { showToast } = useToast();
    const { processRoles, axes } = masters;

    const [systems, setSystems] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [expandedId, setExpandedId] = useState(null);

    // 検索・絞り込み
    const [searchText, setSearchText] = useState('');
    const [filterUseTag, setFilterUseTag] = useState('');
    const [filterResinTag, setFilterResinTag] = useState('');

    // 作成/編集モーダル
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [formSteps, setFormSteps] = useState([]); // [{process_role_id, product_id}]
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    // 「用途系統」「樹脂種別」軸（名前で特定）
    const useAxis = useMemo(() => axes.find((a) => a.name === '用途系統'), [axes]);
    const resinAxis = useMemo(() => axes.find((a) => a.name === '樹脂種別'), [axes]);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [systemsData, productsData] = await Promise.all([
                fetchCoatingSystems(),
                fetchPaintProducts(),
            ]);
            setSystems(systemsData);
            setAllProducts(productsData);
        } catch (error) {
            console.error('塗装仕様取得エラー:', error);
            showToast('塗装仕様の取得に失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // 構成製品のいずれかが該当タグを持つ仕様に絞る（系統×樹脂グレード検索）
    const systemHasTag = (system, tagId) =>
        (system.steps || []).some((step) =>
            ((step.product?.tags) || []).some((t) => t.tag_id === Number(tagId))
        );

    const filteredSystems = useMemo(() => {
        return systems.filter((system) => {
            if (searchText.trim()) {
                const term = searchText.trim().toLowerCase();
                const hit =
                    (system.name || '').toLowerCase().includes(term) ||
                    (system.target_use || '').toLowerCase().includes(term) ||
                    (system.description || '').toLowerCase().includes(term);
                if (!hit) return false;
            }
            if (filterUseTag && !systemHasTag(system, filterUseTag)) return false;
            if (filterResinTag && !systemHasTag(system, filterResinTag)) return false;
            return true;
        });
    }, [systems, searchText, filterUseTag, filterResinTag]);

    const openCreate = () => {
        setForm(emptyForm);
        setFormSteps([]);
        setIsModalOpen(true);
    };

    const openEdit = (system) => {
        setForm({
            id: system.id,
            name: system.name ?? '',
            target_use: system.target_use ?? '',
            description: system.description ?? '',
        });
        setFormSteps(
            (system.steps || []).map((s) => ({
                process_role_id: String(s.process_role_id),
                product_id: String(s.product_id),
            }))
        );
        setIsModalOpen(true);
    };

    const addStep = () => setFormSteps((prev) => [...prev, { process_role_id: '', product_id: '' }]);

    const updateStep = (index, field, value) => {
        setFormSteps((prev) =>
            prev.map((s, i) => {
                if (i !== index) return s;
                // 工程区分を変えたら製品選択をリセット
                if (field === 'process_role_id') return { process_role_id: value, product_id: '' };
                return { ...s, [field]: value };
            })
        );
    };

    const removeStep = (index) => setFormSteps((prev) => prev.filter((_, i) => i !== index));

    const moveStep = (index, dir) => {
        setFormSteps((prev) => {
            const next = [...prev];
            const target = index + dir;
            if (target < 0 || target >= next.length) return prev;
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const handleSave = async () => {
        if (!form.name.trim()) {
            showToast('仕様名は必須です', 'error');
            return;
        }
        if (formSteps.length === 0) {
            showToast('構成行を1行以上追加してください', 'error');
            return;
        }
        if (formSteps.some((s) => !s.process_role_id || !s.product_id)) {
            showToast('すべての構成行で工程区分と製品を選択してください', 'error');
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                target_use: form.target_use.trim() || null,
                description: form.description.trim() || null,
            };
            let systemId = form.id;
            if (form.id) {
                await updateCoatingSystem(form.id, payload);
            } else {
                const created = await createCoatingSystem(payload);
                systemId = created.id;
            }
            await saveCoatingSystemSteps(
                systemId,
                formSteps.map((s) => ({
                    process_role_id: Number(s.process_role_id),
                    product_id: Number(s.product_id),
                }))
            );
            showToast(form.id ? '塗装仕様を更新しました' : '塗装仕様を登録しました', 'success');
            setIsModalOpen(false);
            loadData();
        } catch (error) {
            console.error('塗装仕様保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        setIsSaving(true);
        try {
            await deleteCoatingSystem(id);
            showToast('塗装仕様を削除しました', 'success');
            loadData();
        } catch (error) {
            console.error('塗装仕様削除エラー:', error);
            showToast('削除に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const productsForRole = (roleId) =>
        allProducts.filter((p) => String(p.process_role_id) === String(roleId));

    const selectClass = 'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 outline-none focus:border-blue-400 transition';
    const inputClass = 'w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 text-sm outline-none focus:border-blue-500 transition';
    const labelClass = 'block text-xs font-bold text-slate-500 mb-1';

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <Layers size={18} className="text-blue-500" />
                    塗装仕様（組み合わせレシピ）
                    <span className="text-xs font-bold text-slate-400">{filteredSystems.length}件</span>
                </h3>
                <button
                    onClick={openCreate}
                    className="px-4 py-2 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1 shadow-lg shadow-blue-100"
                >
                    <Plus size={16} /> 仕様を作成
                </button>
            </div>

            {/* 検索バー: 系統×樹脂グレードで構成を探せる */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="仕様名・用途で検索..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 outline-none focus:border-blue-400 transition"
                    />
                </div>
                {useAxis && (
                    <select value={filterUseTag} onChange={(e) => setFilterUseTag(e.target.value)} className={selectClass} aria-label="用途系統で絞り込み">
                        <option value="">用途系統: すべて</option>
                        {useAxis.tags.map((t) => <option key={t.id} value={t.id}>{t.value}</option>)}
                    </select>
                )}
                {resinAxis && (
                    <select value={filterResinTag} onChange={(e) => setFilterResinTag(e.target.value)} className={selectClass} aria-label="樹脂種別で絞り込み">
                        <option value="">樹脂種別: すべて</option>
                        {resinAxis.tags.map((t) => <option key={t.id} value={t.id}>{t.value}</option>)}
                    </select>
                )}
            </div>

            {isLoading ? (
                <div className="p-8 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    読み込み中...
                </div>
            ) : filteredSystems.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-bold text-sm border border-dashed border-slate-200 rounded-xl">
                    塗装仕様が見つかりません。「仕様を作成」から追加してください。
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredSystems.map((system) => {
                        const isExpanded = expandedId === system.id;
                        return (
                            <div key={system.id} className="border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                <div
                                    className="flex items-center justify-between gap-3 p-4 cursor-pointer hover:bg-slate-50 transition"
                                    onClick={() => setExpandedId(isExpanded ? null : system.id)}
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-bold text-slate-800">{system.name}</span>
                                            {system.target_use && (
                                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">{system.target_use}</span>
                                            )}
                                            <span className="text-xs font-bold text-slate-400">{(system.steps || []).length}工程</span>
                                        </div>
                                        {system.description && (
                                            <p className="text-xs text-slate-500 font-bold mt-1 truncate">{system.description}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); openEdit(system); }}
                                            disabled={isSaving}
                                            className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                            aria-label="編集" title="編集"
                                        >
                                            <Edit3 size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(system.id); }}
                                            disabled={isSaving}
                                            className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-2 rounded-lg transition shadow-sm disabled:opacity-50"
                                            aria-label="削除" title="削除"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                        {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left font-bold text-slate-700 text-sm">
                                                <thead>
                                                    <tr className="text-slate-400 text-xs uppercase tracking-wider">
                                                        <th className="pb-2 pr-3 font-bold whitespace-nowrap">順</th>
                                                        <th className="pb-2 pr-3 font-bold whitespace-nowrap">工程区分</th>
                                                        <th className="pb-2 pr-3 font-bold whitespace-nowrap">メーカー</th>
                                                        <th className="pb-2 pr-3 font-bold">製品名</th>
                                                        <th className="pb-2 pr-3 font-bold whitespace-nowrap text-right">標準使用量</th>
                                                        <th className="pb-2 font-bold whitespace-nowrap">希釈率</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {(system.steps || []).map((step) => (
                                                        <tr key={step.id}>
                                                            <td className="py-2 pr-3 text-slate-400">{step.step_order}</td>
                                                            <td className="py-2 pr-3 whitespace-nowrap">
                                                                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold">{step.process_role?.name || '-'}</span>
                                                            </td>
                                                            <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{step.product?.manufacturer?.name || '-'}</td>
                                                            <td className="py-2 pr-3">
                                                                {step.product?.name || '-'}
                                                                {step.product?.product_code && <span className="block text-[10px] text-slate-400 font-mono">{step.product.product_code}</span>}
                                                            </td>
                                                            <td className="py-2 pr-3 text-right whitespace-nowrap">
                                                                {step.product?.standard_usage_rate != null ? `${step.product.standard_usage_rate} ${step.product.usage_rate_unit || ''}` : '-'}
                                                            </td>
                                                            <td className="py-2 whitespace-nowrap">{step.product?.dilution_rate || '-'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 作成/編集モーダル */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center rounded-t-xl">
                            <h4 className="font-bold text-slate-800 flex items-center gap-2">
                                {form.id ? <Edit3 size={18} className="text-blue-600" /> : <Plus size={18} className="text-green-600" />}
                                {form.id ? '塗装仕様の編集' : '塗装仕様の作成'}
                            </h4>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"
                                aria-label="閉じる" title="閉じる"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClass}>仕様名 <span className="text-red-500">*</span></label>
                                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="例: Rc-Ⅰ / 住宅屋根用フッ素系" />
                                </div>
                                <div>
                                    <label className={labelClass}>用途</label>
                                    <input type="text" value={form.target_use} onChange={(e) => setForm({ ...form, target_use: e.target.value })} className={inputClass} placeholder="例: 橋梁 / 住宅屋根" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className={labelClass}>説明</label>
                                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} rows={2} placeholder="補足メモ（任意）" />
                                </div>
                            </div>

                            {/* 構成行ビルダー */}
                            <div className="border-t border-slate-100 pt-4">
                                <div className="flex justify-between items-center mb-2">
                                    <div className="text-xs font-bold text-slate-500">構成（工程順）</div>
                                    <button
                                        onClick={addStep}
                                        className="px-3 py-1.5 rounded-lg font-bold text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 transition flex items-center gap-1"
                                    >
                                        <Plus size={14} /> 行を追加
                                    </button>
                                </div>
                                {formSteps.length === 0 ? (
                                    <div className="p-4 text-center text-slate-400 font-bold text-xs border border-dashed border-slate-200 rounded-lg">
                                        「行を追加」で工程を追加してください
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {formSteps.map((step, index) => {
                                            const candidates = productsForRole(step.process_role_id);
                                            return (
                                                <div key={index} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
                                                    <span className="text-xs font-bold text-slate-400 w-5 text-center shrink-0">{index + 1}</span>
                                                    <select
                                                        value={step.process_role_id}
                                                        onChange={(e) => updateStep(index, 'process_role_id', e.target.value)}
                                                        className="w-32 shrink-0 px-2 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 outline-none focus:border-blue-400 transition"
                                                        aria-label={`${index + 1}行目の工程区分`}
                                                    >
                                                        <option value="">工程区分</option>
                                                        {processRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                                    </select>
                                                    <select
                                                        value={step.product_id}
                                                        onChange={(e) => updateStep(index, 'product_id', e.target.value)}
                                                        disabled={!step.process_role_id}
                                                        className="flex-1 min-w-0 px-2 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 outline-none focus:border-blue-400 transition disabled:bg-slate-100 disabled:text-slate-400"
                                                        aria-label={`${index + 1}行目の製品`}
                                                    >
                                                        <option value="">{step.process_role_id ? (candidates.length ? '製品を選択' : 'この工程の製品なし') : '先に工程区分を選択'}</option>
                                                        {candidates.map((p) => (
                                                            <option key={p.id} value={p.id}>
                                                                {p.manufacturer?.name ? `[${p.manufacturer.name}] ` : ''}{p.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <div className="flex gap-0.5 shrink-0">
                                                        <button onClick={() => moveStep(index, -1)} disabled={index === 0} className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition disabled:opacity-30" aria-label="上へ移動" title="上へ移動">
                                                            <ArrowUp size={14} />
                                                        </button>
                                                        <button onClick={() => moveStep(index, 1)} disabled={index === formSteps.length - 1} className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition disabled:opacity-30" aria-label="下へ移動" title="下へ移動">
                                                            <ArrowDown size={14} />
                                                        </button>
                                                        <button onClick={() => removeStep(index)} className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition" aria-label="行を削除" title="行を削除">
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-xl">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                disabled={isSaving}
                                className="px-5 py-2.5 rounded-lg font-bold text-sm text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 transition disabled:opacity-50"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="px-5 py-2.5 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1 disabled:opacity-50 shadow-lg shadow-blue-100"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {form.id ? '更新する' : '登録する'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!confirmDeleteId}
                onClose={() => setConfirmDeleteId(null)}
                onConfirm={() => { handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                title="塗装仕様を削除"
                message="この塗装仕様を削除してもよろしいですか？"
            />
        </div>
    );
};

export default CoatingSystemsPanel;
