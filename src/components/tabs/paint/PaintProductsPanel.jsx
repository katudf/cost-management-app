import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Plus, Edit3, Trash2, X, Save, Loader2, FlaskConical, Upload, Download } from 'lucide-react';
import { useToast } from '../../Toast';
import ConfirmModal from '../../ConfirmModal';
import {
    fetchPaintProducts,
    createPaintProduct,
    updatePaintProduct,
    deletePaintProduct,
    createPaintProductsBulk,
} from '../../../features/paint/supabasePaint';
import {
    parsePaintProductsMarkdown,
    resolvePaintProductsAgainstMasters,
    buildPaintProductsTemplateMarkdown,
} from '../../../features/paint/paintImportFormat';

const emptyForm = {
    id: null,
    manufacturer_id: '',
    process_role_id: '',
    name: '',
    product_code: '',
    standard_usage_rate: '',
    usage_rate_unit: '',
    recoat_interval_standard_days: '',
    recoat_interval_max_days: '',
    dilution_rate: '',
    pot_life: '',
    drying_time: '',
    reference_price: '',
    reference_price_unit: '',
};

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const textOrNull = (v) => {
    const t = (v || '').trim();
    return t === '' ? null : t;
};

const formatRecoat = (p) => {
    if (p.recoat_interval_standard_days == null && p.recoat_interval_max_days == null) return '-';
    const std = p.recoat_interval_standard_days != null ? `${p.recoat_interval_standard_days}日` : '-';
    const max = p.recoat_interval_max_days != null ? `〜${p.recoat_interval_max_days}日` : '';
    return `${std}${max}`;
};

const PaintProductsPanel = ({ masters }) => {
    const { showToast } = useToast();
    const { manufacturers, processRoles, axes, standards = [] } = masters;

    const [products, setProducts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // フィルタ
    const [filterManufacturer, setFilterManufacturer] = useState('');
    const [filterRole, setFilterRole] = useState('');
    const [filterTagByAxis, setFilterTagByAxis] = useState({}); // { [axisId]: tagId }
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');

    // 登録/編集モーダル
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [formTagIds, setFormTagIds] = useState([]);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    // MD一括インポート
    const fileInputRef = useRef(null);
    const [importPreview, setImportPreview] = useState(null); // { fileName, valid, errors }
    const [isImporting, setIsImporting] = useState(false);

    // フリーワードは300msデバウンス
    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const selectedTagIds = useMemo(
        () => Object.values(filterTagByAxis).filter(Boolean).map(Number),
        [filterTagByAxis]
    );

    const loadProducts = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await fetchPaintProducts({
                manufacturerId: filterManufacturer ? Number(filterManufacturer) : null,
                processRoleId: filterRole ? Number(filterRole) : null,
                tagIds: selectedTagIds,
                search,
            });
            setProducts(data);
        } catch (error) {
            console.error('塗料製品取得エラー:', error);
            showToast('塗料製品の取得に失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [filterManufacturer, filterRole, selectedTagIds, search, showToast]);

    useEffect(() => {
        loadProducts();
    }, [loadProducts]);

    // 工程区分 sort_order → メーカー名 → 製品名 の順（同一工程でのメーカー横断比較用）
    const sortedProducts = useMemo(() => {
        return [...products].sort((a, b) => {
            const roleDiff = (a.process_role?.sort_order ?? 999) - (b.process_role?.sort_order ?? 999);
            if (roleDiff !== 0) return roleDiff;
            const makerDiff = (a.manufacturer?.name || '').localeCompare(b.manufacturer?.name || '', 'ja');
            if (makerDiff !== 0) return makerDiff;
            return (a.name || '').localeCompare(b.name || '', 'ja');
        });
    }, [products]);

    const tagMap = useMemo(() => {
        const map = new Map();
        axes.forEach((axis) => axis.tags.forEach((t) => map.set(t.id, t)));
        return map;
    }, [axes]);

    const openCreate = () => {
        setForm(emptyForm);
        setFormTagIds([]);
        setImportPreview(null);
        setIsModalOpen(true);
    };

    const openEdit = (product) => {
        setForm({
            id: product.id,
            manufacturer_id: product.manufacturer_id ?? '',
            process_role_id: product.process_role_id ?? '',
            name: product.name ?? '',
            product_code: product.product_code ?? '',
            standard_usage_rate: product.standard_usage_rate ?? '',
            usage_rate_unit: product.usage_rate_unit ?? '',
            recoat_interval_standard_days: product.recoat_interval_standard_days ?? '',
            recoat_interval_max_days: product.recoat_interval_max_days ?? '',
            dilution_rate: product.dilution_rate ?? '',
            pot_life: product.pot_life ?? '',
            drying_time: product.drying_time ?? '',
            reference_price: product.reference_price ?? '',
            reference_price_unit: product.reference_price_unit ?? '',
        });
        setFormTagIds(product.tagIds || []);
        setIsModalOpen(true);
    };

    const toggleFormTag = (tagId) => {
        setFormTagIds((prev) =>
            prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
        );
    };

    const handleSave = async () => {
        if (!form.manufacturer_id || !form.process_role_id || !form.name.trim()) {
            showToast('メーカー・工程区分・製品名は必須です', 'error');
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                manufacturer_id: Number(form.manufacturer_id),
                process_role_id: Number(form.process_role_id),
                name: form.name.trim(),
                product_code: textOrNull(form.product_code),
                standard_usage_rate: numOrNull(form.standard_usage_rate),
                usage_rate_unit: textOrNull(form.usage_rate_unit),
                recoat_interval_standard_days: numOrNull(form.recoat_interval_standard_days),
                recoat_interval_max_days: numOrNull(form.recoat_interval_max_days),
                dilution_rate: textOrNull(form.dilution_rate),
                pot_life: textOrNull(form.pot_life),
                drying_time: textOrNull(form.drying_time),
                reference_price: numOrNull(form.reference_price),
                reference_price_unit: textOrNull(form.reference_price_unit),
            };
            if (form.id) {
                await updatePaintProduct(form.id, payload, formTagIds);
                showToast('塗料製品を更新しました', 'success');
            } else {
                await createPaintProduct(payload, formTagIds);
                showToast('塗料製品を登録しました', 'success');
            }
            setIsModalOpen(false);
            loadProducts();
        } catch (error) {
            console.error('塗料製品保存エラー:', error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // --- MD一括インポート ---

    const handleDownloadTemplate = () => {
        const md = buildPaintProductsTemplateMarkdown({ manufacturers, processRoles, axes, standards });
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '塗料製品_一括登録フォーマット.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleFileSelected = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // 同じファイルを再選択できるようにリセット
        if (!file) return;
        try {
            const text = await file.text();
            const { items, errors: parseErrors } = parsePaintProductsMarkdown(text);
            const { valid, errors: resolveErrors } = resolvePaintProductsAgainstMasters(items, {
                manufacturers,
                processRoles,
                axes,
                standards,
            });
            setImportPreview({
                fileName: file.name,
                valid,
                errors: [...parseErrors, ...resolveErrors],
            });
        } catch (error) {
            console.error('MDファイル読み込みエラー:', error);
            showToast('ファイルの読み込みに失敗しました', 'error');
        }
    };

    const handleRunImport = async () => {
        if (!importPreview || importPreview.valid.length === 0) return;
        setIsImporting(true);
        try {
            await createPaintProductsBulk(importPreview.valid);
            showToast(`${importPreview.valid.length}件の塗料製品を登録しました`, 'success');
            setImportPreview(null);
            setIsModalOpen(false);
            loadProducts();
        } catch (error) {
            console.error('塗料製品一括登録エラー:', error);
            showToast('一括登録に失敗しました', 'error');
        } finally {
            setIsImporting(false);
        }
    };

    const handleDelete = async (id) => {
        setIsSaving(true);
        try {
            await deletePaintProduct(id);
            showToast('塗料製品を削除しました', 'success');
            loadProducts();
        } catch (error) {
            console.error('塗料製品削除エラー:', error);
            showToast('削除に失敗しました', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const renderTagBadges = (tagIds) => (
        <div className="flex flex-wrap gap-1">
            {(tagIds || []).map((tagId) => {
                const tag = tagMap.get(tagId);
                if (!tag) return null;
                return (
                    <span key={tagId} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold whitespace-nowrap">
                        {tag.value}
                    </span>
                );
            })}
        </div>
    );

    const selectClass = 'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 outline-none focus:border-blue-400 transition';
    const inputClass = 'w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 font-bold text-slate-700 text-sm outline-none focus:border-blue-500 transition';
    const labelClass = 'block text-xs font-bold text-slate-500 mb-1';

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <FlaskConical size={18} className="text-blue-500" />
                    塗料製品一覧
                    <span className="text-xs font-bold text-slate-400">{sortedProducts.length}件</span>
                </h3>
                <button
                    onClick={openCreate}
                    className="px-4 py-2 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1 shadow-lg shadow-blue-100"
                >
                    <Plus size={16} /> 製品を登録
                </button>
            </div>

            {/* フィルタバー */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="col-span-2 md:col-span-4 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="製品名・品番で検索..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 outline-none focus:border-blue-400 transition"
                    />
                </div>
                <select value={filterManufacturer} onChange={(e) => setFilterManufacturer(e.target.value)} className={selectClass} aria-label="メーカーで絞り込み">
                    <option value="">メーカー: すべて</option>
                    {manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className={selectClass} aria-label="工程区分で絞り込み">
                    <option value="">工程区分: すべて</option>
                    {processRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {axes.map((axis) => (
                    <select
                        key={axis.id}
                        value={filterTagByAxis[axis.id] || ''}
                        onChange={(e) => setFilterTagByAxis((prev) => ({ ...prev, [axis.id]: e.target.value }))}
                        className={selectClass}
                        aria-label={`${axis.name}で絞り込み`}
                    >
                        <option value="">{axis.name}: すべて</option>
                        {axis.tags.map((t) => <option key={t.id} value={t.id}>{t.value}</option>)}
                    </select>
                ))}
            </div>

            {isLoading ? (
                <div className="p-8 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    読み込み中...
                </div>
            ) : sortedProducts.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-bold text-sm border border-dashed border-slate-200 rounded-xl">
                    塗料製品が見つかりません。「製品を登録」から追加してください。
                </div>
            ) : (
                <>
                    {/* デスクトップ: テーブル */}
                    <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left font-bold text-slate-700">
                            <thead>
                                <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wider">
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap">工程区分</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap">メーカー</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap">製品名</th>
                                    <th className="p-3 font-bold border-b border-slate-200">タグ</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap text-right">標準使用量</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap">上塗間隔</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap">希釈率</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap">可使時間</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap">乾燥時間</th>
                                    <th className="p-3 font-bold border-b border-slate-200 whitespace-nowrap text-right">参考単価</th>
                                    <th className="p-3 font-bold border-b border-slate-200 text-center whitespace-nowrap">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {sortedProducts.map((p) => (
                                    <tr key={p.id} className="hover:bg-slate-50 transition">
                                        <td className="p-3 text-sm whitespace-nowrap">
                                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold">{p.process_role?.name || '-'}</span>
                                        </td>
                                        <td className="p-3 text-sm text-slate-500 whitespace-nowrap">{p.manufacturer?.name || '-'}</td>
                                        <td className="p-3 text-sm text-slate-800">
                                            {p.name}
                                            {p.product_code && <span className="block text-[10px] text-slate-400 font-mono">{p.product_code}</span>}
                                        </td>
                                        <td className="p-3">{renderTagBadges(p.tagIds)}</td>
                                        <td className="p-3 text-sm text-slate-600 text-right whitespace-nowrap">
                                            {p.standard_usage_rate != null ? `${p.standard_usage_rate} ${p.usage_rate_unit || ''}` : '-'}
                                        </td>
                                        <td className="p-3 text-sm text-slate-600 whitespace-nowrap">{formatRecoat(p)}</td>
                                        <td className="p-3 text-sm text-slate-600">{p.dilution_rate || '-'}</td>
                                        <td className="p-3 text-sm text-slate-600">{p.pot_life || '-'}</td>
                                        <td className="p-3 text-sm text-slate-600">{p.drying_time || '-'}</td>
                                        <td className="p-3 text-sm text-slate-600 text-right whitespace-nowrap">
                                            {p.reference_price != null ? `¥${Number(p.reference_price).toLocaleString()}${p.reference_price_unit ? `/${p.reference_price_unit}` : ''}` : '-'}
                                        </td>
                                        <td className="p-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => openEdit(p)}
                                                    disabled={isSaving}
                                                    className="bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:border-blue-300 p-1.5 rounded-lg transition shadow-sm disabled:opacity-50"
                                                    aria-label="編集" title="編集"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDeleteId(p.id)}
                                                    disabled={isSaving}
                                                    className="bg-white border border-slate-200 text-red-500 hover:text-red-600 hover:border-red-300 p-1.5 rounded-lg transition shadow-sm disabled:opacity-50"
                                                    aria-label="削除" title="削除"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* モバイル: カード */}
                    <div className="md:hidden space-y-3">
                        {sortedProducts.map((p) => (
                            <div key={p.id} className="border border-slate-200 rounded-xl p-4 shadow-sm">
                                <div className="flex justify-between items-start gap-2 mb-2">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold">{p.process_role?.name || '-'}</span>
                                            <span className="text-xs font-bold text-slate-400">{p.manufacturer?.name || '-'}</span>
                                        </div>
                                        <div className="font-bold text-slate-800">{p.name}</div>
                                        {p.product_code && <div className="text-[10px] text-slate-400 font-mono">{p.product_code}</div>}
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <button
                                            onClick={() => openEdit(p)}
                                            disabled={isSaving}
                                            className="bg-white border border-slate-200 text-blue-600 p-2 rounded-lg shadow-sm disabled:opacity-50"
                                            aria-label="編集" title="編集"
                                        >
                                            <Edit3 size={16} />
                                        </button>
                                        <button
                                            onClick={() => setConfirmDeleteId(p.id)}
                                            disabled={isSaving}
                                            className="bg-white border border-slate-200 text-red-500 p-2 rounded-lg shadow-sm disabled:opacity-50"
                                            aria-label="削除" title="削除"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                                <div className="mb-2">{renderTagBadges(p.tagIds)}</div>
                                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm font-bold">
                                    <div><dt className="text-[10px] text-slate-400">標準使用量</dt><dd className="text-slate-700">{p.standard_usage_rate != null ? `${p.standard_usage_rate} ${p.usage_rate_unit || ''}` : '-'}</dd></div>
                                    <div><dt className="text-[10px] text-slate-400">上塗間隔</dt><dd className="text-slate-700">{formatRecoat(p)}</dd></div>
                                    <div><dt className="text-[10px] text-slate-400">希釈率</dt><dd className="text-slate-700">{p.dilution_rate || '-'}</dd></div>
                                    <div><dt className="text-[10px] text-slate-400">可使時間</dt><dd className="text-slate-700">{p.pot_life || '-'}</dd></div>
                                    <div><dt className="text-[10px] text-slate-400">乾燥時間</dt><dd className="text-slate-700">{p.drying_time || '-'}</dd></div>
                                    <div><dt className="text-[10px] text-slate-400">参考単価</dt><dd className="text-slate-700">{p.reference_price != null ? `¥${Number(p.reference_price).toLocaleString()}${p.reference_price_unit ? `/${p.reference_price_unit}` : ''}` : '-'}</dd></div>
                                </dl>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* 登録/編集モーダル */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center rounded-t-xl">
                            <h4 className="font-bold text-slate-800 flex items-center gap-2">
                                {form.id ? <Edit3 size={18} className="text-blue-600" /> : <Plus size={18} className="text-green-600" />}
                                {form.id ? '塗料製品の編集' : '塗料製品の登録'}
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
                            {/* MDファイルからの一括登録（新規登録時のみ） */}
                            {!form.id && (
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="text-sm font-bold text-slate-700">MDファイルから一括登録</div>
                                            <div className="text-[11px] font-bold text-slate-400 mt-0.5">
                                                1つのファイルで複数の製品をまとめて登録できます
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <button
                                                onClick={handleDownloadTemplate}
                                                className="px-3 py-2 rounded-lg font-bold text-xs bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition flex items-center gap-1"
                                                title="登録用フォーマットをダウンロード"
                                            >
                                                <Download size={14} /> フォーマット
                                            </button>
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                className="px-3 py-2 rounded-lg font-bold text-xs bg-emerald-600 text-white hover:bg-emerald-700 transition flex items-center gap-1"
                                                title="MDファイルを読み込む"
                                            >
                                                <Upload size={14} /> 読み込み
                                            </button>
                                        </div>
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".md,.markdown,.txt,text/markdown"
                                        onChange={handleFileSelected}
                                        className="hidden"
                                        aria-label="一括登録用MDファイルを選択"
                                    />

                                    {importPreview && (
                                        <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
                                            <div className="text-xs font-bold text-slate-500">
                                                {importPreview.fileName}：登録可能 {importPreview.valid.length}件
                                                {importPreview.errors.length > 0 && ` / エラー ${importPreview.errors.length}件`}
                                            </div>

                                            {importPreview.valid.length > 0 && (
                                                <ul className="max-h-32 overflow-y-auto bg-white border border-slate-200 rounded-lg p-2 space-y-0.5">
                                                    {importPreview.valid.map((v, i) => (
                                                        <li key={i} className="text-xs font-bold text-slate-600">・{v.name}</li>
                                                    ))}
                                                </ul>
                                            )}

                                            {importPreview.errors.length > 0 && (
                                                <ul className="max-h-32 overflow-y-auto bg-red-50 border border-red-200 rounded-lg p-2 space-y-0.5">
                                                    {importPreview.errors.map((msg, i) => (
                                                        <li key={i} className="text-xs font-bold text-red-600">・{msg}</li>
                                                    ))}
                                                </ul>
                                            )}

                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => setImportPreview(null)}
                                                    disabled={isImporting}
                                                    className="px-3 py-2 rounded-lg font-bold text-xs text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 transition disabled:opacity-50"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={handleRunImport}
                                                    disabled={isImporting || importPreview.valid.length === 0}
                                                    className="px-3 py-2 rounded-lg font-bold text-xs bg-emerald-600 text-white hover:bg-emerald-700 transition flex items-center gap-1 disabled:opacity-50"
                                                >
                                                    {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                    {importPreview.valid.length}件を登録
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClass}>メーカー <span className="text-red-500">*</span></label>
                                    <select
                                        value={form.manufacturer_id}
                                        onChange={(e) => setForm({ ...form, manufacturer_id: e.target.value })}
                                        className={inputClass}
                                    >
                                        <option value="">選択してください</option>
                                        {manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                    {manufacturers.length === 0 && (
                                        <p className="text-[10px] text-amber-600 font-bold mt-1">メーカー未登録です。「マスタ管理」タブで先に登録してください。</p>
                                    )}
                                </div>
                                <div>
                                    <label className={labelClass}>工程区分 <span className="text-red-500">*</span></label>
                                    <select
                                        value={form.process_role_id}
                                        onChange={(e) => setForm({ ...form, process_role_id: e.target.value })}
                                        className={inputClass}
                                    >
                                        <option value="">選択してください</option>
                                        {processRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>製品名 <span className="text-red-500">*</span></label>
                                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="例: ○○シリコンさび止め" />
                                </div>
                                <div>
                                    <label className={labelClass}>品番</label>
                                    <input type="text" value={form.product_code} onChange={(e) => setForm({ ...form, product_code: e.target.value })} className={inputClass} placeholder="メーカー品番" />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={labelClass}>標準使用量</label>
                                        <input type="number" min="0" step="any" value={form.standard_usage_rate} onChange={(e) => setForm({ ...form, standard_usage_rate: e.target.value })} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>使用量単位</label>
                                        <input type="text" value={form.usage_rate_unit} onChange={(e) => setForm({ ...form, usage_rate_unit: e.target.value })} className={inputClass} placeholder="g/m²" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={labelClass}>上塗間隔・標準（日）</label>
                                        <input type="number" min="0" value={form.recoat_interval_standard_days} onChange={(e) => setForm({ ...form, recoat_interval_standard_days: e.target.value })} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>上塗間隔・上限（日）</label>
                                        <input type="number" min="0" value={form.recoat_interval_max_days} onChange={(e) => setForm({ ...form, recoat_interval_max_days: e.target.value })} className={inputClass} />
                                    </div>
                                </div>
                                <div>
                                    <label className={labelClass}>希釈率</label>
                                    <input type="text" value={form.dilution_rate} onChange={(e) => setForm({ ...form, dilution_rate: e.target.value })} className={inputClass} placeholder="例: 清水 5〜10%" />
                                </div>
                                <div>
                                    <label className={labelClass}>可使時間</label>
                                    <input type="text" value={form.pot_life} onChange={(e) => setForm({ ...form, pot_life: e.target.value })} className={inputClass} placeholder="例: 5時間（23℃）" />
                                </div>
                                <div>
                                    <label className={labelClass}>乾燥時間</label>
                                    <input type="text" value={form.drying_time} onChange={(e) => setForm({ ...form, drying_time: e.target.value })} className={inputClass} placeholder="例: 4時間以上（23℃）" />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className={labelClass}>参考単価（円）</label>
                                        <input type="number" min="0" step="any" value={form.reference_price} onChange={(e) => setForm({ ...form, reference_price: e.target.value })} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>単価単位</label>
                                        <input type="text" value={form.reference_price_unit} onChange={(e) => setForm({ ...form, reference_price_unit: e.target.value })} className={inputClass} placeholder="缶 / kg など" />
                                    </div>
                                </div>
                            </div>

                            {/* タグ選択（軸ごと） */}
                            <div className="border-t border-slate-100 pt-4 space-y-3">
                                {axes.map((axis) => (
                                    <div key={axis.id}>
                                        <div className="text-xs font-bold text-slate-500 mb-1.5">{axis.name}</div>
                                        <div className="flex flex-wrap gap-2">
                                            {axis.tags.map((tag) => (
                                                <label key={tag.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition ${
                                                    formTagIds.includes(tag.id)
                                                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                                }`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={formTagIds.includes(tag.id)}
                                                        onChange={() => toggleFormTag(tag.id)}
                                                        className="accent-blue-600"
                                                    />
                                                    {tag.value}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
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
                title="塗料製品を削除"
                message="この塗料製品を削除してもよろしいですか？（塗装仕様で使用中の場合は構成の見直しが必要です）"
            />
        </div>
    );
};

export default PaintProductsPanel;
