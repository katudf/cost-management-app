import React, { useState, useMemo, useEffect } from 'react';
import {
    Loader2, LogOut, Package, Search, Plus, Map as MapIcon, Home, X,
    Trash2, ImageIcon, Minus, Upload, MapPin,
} from 'lucide-react';
import { useToast } from './components/Toast';
import { useAuth } from './hooks/useAuth';
import LoginScreen from './components/auth/LoginScreen';
import ResetPasswordScreen from './components/auth/ResetPasswordScreen';
import { useInventory } from './hooks/useInventory';
import { INVENTORY_CATEGORY_LIST, INVENTORY_CATEGORY_COLOR } from './utils/constants';

// ローカルタイムゾーンで 'YYYY-MM-DD' を生成
const formatDateLocal = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const IMAGE_KEYS = ['image_url_1', 'image_url_2', 'image_url_3'];

const emptyForm = () => ({
    name: '',
    detail: '',
    warehouse_id: '',
    shelf_code: '',
    slot_number: '',
    quantity: 1,
    category: '',
    recorded_date: formatDateLocal(new Date()),
    image_url_1: null,
    image_url_2: null,
    image_url_3: null,
});

const InventoryApp = () => {
    const { showToast } = useToast();
    const { isAuthenticated, isLoading: isAuthLoading, isPasswordRecovery } = useAuth();
    const {
        items, warehouses, workers, isLoading,
        saveItem, deleteItem, updateQuantity, uploadWarehouseMap,
    } = useInventory({ showToast });

    const [loggedInWorker, setLoggedInWorker] = useState(null);
    const [tab, setTab] = useState('home');
    const [searchText, setSearchText] = useState('');
    const [filterWarehouse, setFilterWarehouse] = useState('');
    const [filterCategory, setFilterCategory] = useState('');

    // フォームモーダル: null=閉、{ id: null }=新規、{ id: n, ... }=編集
    const [editingId, setEditingId] = useState(null); // null | 'new' | number
    const [form, setForm] = useState(emptyForm());
    const [imageFiles, setImageFiles] = useState({});
    const [imagePreviews, setImagePreviews] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [uploadingMapId, setUploadingMapId] = useState(null);

    // WorkerAppと同じ保存キーを共用（日報アプリでログイン済みならそのまま使える）
    useEffect(() => {
        const saved = localStorage.getItem('cost-app-worker');
        if (saved) {
            try { setLoggedInWorker(JSON.parse(saved)); } catch { /* ignore */ }
        }
    }, []);

    const handleLogin = (worker) => {
        setLoggedInWorker(worker);
        localStorage.setItem('cost-app-worker', JSON.stringify(worker));
    };

    const handleLogout = () => {
        setLoggedInWorker(null);
        localStorage.removeItem('cost-app-worker');
    };

    // ===== オートコンプリート候補 =====
    const nameSuggestions = useMemo(
        () => [...new Set(items.map(i => i.name).filter(Boolean))].sort(),
        [items]
    );
    const detailSuggestions = useMemo(
        () => [...new Set(items.map(i => i.detail).filter(Boolean))].sort(),
        [items]
    );
    const shelfSuggestions = useMemo(
        () => [...new Set(items.map(i => i.shelf_code).filter(Boolean))].sort(),
        [items]
    );

    // ===== フィルタ済みリスト =====
    const filteredItems = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        return items.filter(i => {
            if (filterWarehouse && String(i.warehouse_id) !== String(filterWarehouse)) return false;
            if (filterCategory && i.category !== filterCategory) return false;
            if (q) {
                const target = `${i.name || ''} ${i.detail || ''} ${i.shelf_code || ''} ${i.recorded_by || ''}`.toLowerCase();
                if (!target.includes(q)) return false;
            }
            return true;
        });
    }, [items, searchText, filterWarehouse, filterCategory]);

    const warehouseName = (id) => warehouses.find(w => w.id === id)?.name || '';

    // ===== フォーム操作 =====
    const openNewForm = () => {
        setForm({ ...emptyForm(), warehouse_id: warehouses[0]?.id ?? '' });
        setImageFiles({});
        setImagePreviews({});
        setEditingId('new');
    };

    const openEditForm = (item) => {
        setForm({
            name: item.name || '',
            detail: item.detail || '',
            warehouse_id: item.warehouse_id ?? '',
            shelf_code: item.shelf_code || '',
            slot_number: item.slot_number ?? '',
            quantity: item.quantity ?? 0,
            category: item.category || '',
            recorded_date: item.recorded_date || formatDateLocal(new Date()),
            image_url_1: item.image_url_1 || null,
            image_url_2: item.image_url_2 || null,
            image_url_3: item.image_url_3 || null,
        });
        setImageFiles({});
        setImagePreviews({});
        setEditingId(item.id);
    };

    const closeForm = () => {
        setEditingId(null);
        Object.values(imagePreviews).forEach(url => URL.revokeObjectURL(url));
        setImagePreviews({});
        setImageFiles({});
    };

    const handleImageSelect = (key, file) => {
        if (!file) return;
        if (imagePreviews[key]) URL.revokeObjectURL(imagePreviews[key]);
        setImageFiles(prev => ({ ...prev, [key]: file }));
        setImagePreviews(prev => ({ ...prev, [key]: URL.createObjectURL(file) }));
    };

    const handleImageClear = (key) => {
        if (imagePreviews[key]) URL.revokeObjectURL(imagePreviews[key]);
        setImageFiles(prev => { const n = { ...prev }; delete n[key]; return n; });
        setImagePreviews(prev => { const n = { ...prev }; delete n[key]; return n; });
        setForm(prev => ({ ...prev, [key]: null }));
    };

    const handleSave = async () => {
        if (!form.name || form.name.trim() === '') {
            showToast('品名は必須です', 'error');
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                detail: form.detail.trim() || null,
                warehouse_id: form.warehouse_id ? Number(form.warehouse_id) : null,
                shelf_code: form.shelf_code.trim() || null,
                slot_number: form.slot_number === '' ? null : Number(form.slot_number),
                quantity: Number(form.quantity) || 0,
                category: form.category || null,
                recorded_date: form.recorded_date || null,
                image_url_1: form.image_url_1,
                image_url_2: form.image_url_2,
                image_url_3: form.image_url_3,
            };
            if (editingId === 'new') {
                payload.worker_id = loggedInWorker?.id ?? null;
                payload.recorded_by = loggedInWorker?.name ?? null;
            }
            const ok = await saveItem(payload, editingId === 'new' ? null : editingId, imageFiles);
            if (ok) closeForm();
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        const item = items.find(i => i.id === editingId);
        if (!item) return;
        const ok = await deleteItem(item);
        if (ok) closeForm();
    };

    const handleMapUpload = async (warehouseId, file) => {
        if (!file) return;
        setUploadingMapId(warehouseId);
        try {
            await uploadWarehouseMap(warehouseId, file);
        } finally {
            setUploadingMapId(null);
        }
    };

    // ========== ローディング ==========
    if (isAuthLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-100">
                <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
            </div>
        );
    }

    if (isPasswordRecovery) {
        return <ResetPasswordScreen />;
    }

    if (!isAuthenticated) {
        return <LoginScreen title="在庫管理システム" subtitle="ログイン" />;
    }

    if (isLoading && !loggedInWorker) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-100">
                <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
            </div>
        );
    }

    // ========== 作業員選択画面 ==========
    if (!loggedInWorker) {
        return (
            <div className="min-h-screen bg-slate-100 flex flex-col items-center p-4">
                <div className="w-full max-w-sm mt-10">
                    <div className="bg-white rounded-2xl shadow-lg p-6 text-center border-t-4 border-emerald-600">
                        <Package className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
                        <h1 className="text-2xl font-black text-slate-800 mb-2">在庫管理システム</h1>
                        <p className="text-sm font-bold text-slate-500 mb-8">名前を選んでください</p>
                        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto px-1 pb-4">
                            {workers.map(w => (
                                <button key={w.id} onClick={() => handleLogin(w)}
                                    className="w-full bg-slate-50 border-2 border-slate-200 p-4 rounded-xl text-lg font-bold text-slate-700 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 transition active:scale-[0.98]"
                                >{w.name}</button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ========== メイン画面 ==========
    return (
        <div className="min-h-screen bg-slate-100 pb-20">
            {/* ヘッダー */}
            <header className="bg-emerald-700 text-white sticky top-0 z-30 shadow-md">
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
                    <h1 className="text-lg font-black flex items-center gap-2">
                        <Package size={22} /> 在庫管理
                    </h1>
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-bold">{loggedInWorker.name}</span>
                        <button onClick={handleLogout} aria-label="ログアウト" title="ログアウト"
                            className="p-2 rounded-full hover:bg-emerald-600 transition">
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-3 pt-3">
                {tab === 'home' && (
                    <>
                        {/* 検索・フィルタ */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 mb-3 space-y-2">
                            <div className="relative">
                                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="search"
                                    value={searchText}
                                    onChange={e => setSearchText(e.target.value)}
                                    placeholder="品名・詳細・棚番で検索"
                                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none text-sm"
                                />
                            </div>
                            <div className="flex gap-2">
                                <select
                                    value={filterWarehouse}
                                    onChange={e => setFilterWarehouse(e.target.value)}
                                    aria-label="倉庫で絞り込み"
                                    className="flex-1 py-2 px-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700"
                                >
                                    <option value="">全ての倉庫</option>
                                    {warehouses.map(w => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
                                <select
                                    value={filterCategory}
                                    onChange={e => setFilterCategory(e.target.value)}
                                    aria-label="種類で絞り込み"
                                    className="flex-1 py-2 px-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700"
                                >
                                    <option value="">全ての種類</option>
                                    {INVENTORY_CATEGORY_LIST.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-xs text-slate-400 font-bold text-right">{filteredItems.length}件</p>
                        </div>

                        {/* カードリスト */}
                        {isLoading ? (
                            <div className="flex justify-center py-16">
                                <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                            </div>
                        ) : filteredItems.length === 0 ? (
                            <div className="text-center py-16 text-slate-400 font-bold">
                                該当する在庫がありません
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredItems.map(item => (
                                    <div key={item.id}
                                        className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex gap-3 items-start">
                                        {/* サムネイル */}
                                        <button onClick={() => openEditForm(item)}
                                            aria-label={`${item.name}を編集`} title={`${item.name}を編集`}
                                            className="w-16 h-16 rounded-lg bg-slate-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
                                            {item.image_url_1 ? (
                                                <img src={item.image_url_1} alt={item.name}
                                                    className="w-full h-full object-cover" loading="lazy" />
                                            ) : (
                                                <ImageIcon size={24} className="text-slate-300" />
                                            )}
                                        </button>
                                        {/* 本体（タップで編集） */}
                                        <button onClick={() => openEditForm(item)}
                                            className="flex-1 min-w-0 text-left">
                                            <div className="flex items-start gap-2">
                                                <p className="font-bold text-slate-800 text-sm leading-snug flex-1 break-words">{item.name}</p>
                                                {item.category && (
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${INVENTORY_CATEGORY_COLOR[item.category] || 'bg-slate-100 text-slate-600'}`}>
                                                        {item.category}
                                                    </span>
                                                )}
                                            </div>
                                            {item.detail && (
                                                <p className="text-xs text-slate-500 mt-0.5 break-words">{item.detail}</p>
                                            )}
                                            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                                <MapPin size={12} className="flex-shrink-0" />
                                                {[warehouseName(item.warehouse_id), item.shelf_code, item.slot_number != null && item.slot_number !== '' ? `位置${item.slot_number}` : null]
                                                    .filter(Boolean).join(' / ') || '保管場所未設定'}
                                            </p>
                                        </button>
                                        {/* 個数ステッパー */}
                                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => updateQuantity(item.id, Number(item.quantity || 0) + 1)}
                                                aria-label="個数を増やす" title="個数を増やす"
                                                className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center active:scale-95 transition">
                                                <Plus size={16} />
                                            </button>
                                            <span className="text-sm font-black text-slate-800 min-w-[2rem] text-center">
                                                {Number(item.quantity || 0)}
                                            </span>
                                            <button
                                                onClick={() => updateQuantity(item.id, Math.max(0, Number(item.quantity || 0) - 1))}
                                                disabled={Number(item.quantity || 0) <= 0}
                                                aria-label="個数を減らす" title="個数を減らす"
                                                className="w-8 h-8 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 flex items-center justify-center active:scale-95 transition disabled:opacity-30">
                                                <Minus size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* FAB: 新規追加 */}
                        <button onClick={openNewForm}
                            aria-label="在庫を追加" title="在庫を追加"
                            className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-emerald-600 text-white shadow-xl flex items-center justify-center hover:bg-emerald-700 active:scale-95 transition z-30">
                            <Plus size={28} />
                        </button>
                    </>
                )}

                {tab === 'map' && (
                    <div className="space-y-4">
                        {warehouses.map(w => (
                            <div key={w.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
                                    <h2 className="font-bold text-slate-800 flex items-center gap-2">
                                        <MapIcon size={18} className="text-emerald-600" /> {w.name}
                                    </h2>
                                    <label className="cursor-pointer text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 flex items-center gap-1 hover:bg-emerald-100 transition">
                                        {uploadingMapId === w.id
                                            ? <Loader2 size={14} className="animate-spin" />
                                            : <Upload size={14} />}
                                        位置図を{w.map_image_url ? '差し替え' : 'アップロード'}
                                        <input type="file" accept="image/*" className="hidden"
                                            aria-label={`${w.name}の位置図をアップロード`}
                                            onChange={e => { handleMapUpload(w.id, e.target.files?.[0]); e.target.value = ''; }} />
                                    </label>
                                </div>
                                {w.map_image_url ? (
                                    <img src={w.map_image_url} alt={`${w.name}の位置図`}
                                        className="w-full object-contain bg-slate-50" loading="lazy" />
                                ) : (
                                    <div className="py-12 text-center text-slate-300 text-sm font-bold">
                                        位置図が未登録です
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* ボトムナビ */}
            <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30">
                <div className="max-w-3xl mx-auto grid grid-cols-2">
                    <button onClick={() => setTab('home')}
                        className={`py-3 flex flex-col items-center gap-0.5 text-xs font-bold transition ${tab === 'home' ? 'text-emerald-600' : 'text-slate-400'}`}>
                        <Home size={20} /> ホーム
                    </button>
                    <button onClick={() => setTab('map')}
                        className={`py-3 flex flex-col items-center gap-0.5 text-xs font-bold transition ${tab === 'map' ? 'text-emerald-600' : 'text-slate-400'}`}>
                        <MapIcon size={20} /> 位置図
                    </button>
                </div>
            </nav>

            {/* 登録・編集フォーム */}
            {editingId !== null && (
                <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
                    onClick={closeForm}>
                    <div onClick={e => e.stopPropagation()}
                        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
                        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between z-10">
                            <h2 className="font-black text-slate-800">
                                {editingId === 'new' ? '在庫を追加' : '在庫を編集'}
                            </h2>
                            <button onClick={closeForm} aria-label="閉じる" title="閉じる"
                                className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-4 space-y-4">
                            {/* 品名 */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">品名 <span className="text-red-500">*</span></label>
                                <input type="text" list="inv-name-list" value={form.name}
                                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                                    className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-400 outline-none text-sm" />
                                <datalist id="inv-name-list">
                                    {nameSuggestions.map(n => <option key={n} value={n} />)}
                                </datalist>
                            </div>
                            {/* 詳細 */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">詳細（色番・型番など）</label>
                                <input type="text" list="inv-detail-list" value={form.detail}
                                    onChange={e => setForm(p => ({ ...p, detail: e.target.value }))}
                                    className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-400 outline-none text-sm" />
                                <datalist id="inv-detail-list">
                                    {detailSuggestions.map(d => <option key={d} value={d} />)}
                                </datalist>
                            </div>
                            {/* 倉庫・保管場所・位置 */}
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">倉庫</label>
                                    <select value={form.warehouse_id}
                                        onChange={e => setForm(p => ({ ...p, warehouse_id: e.target.value }))}
                                        className="w-full p-2.5 rounded-lg border border-slate-200 text-sm bg-white">
                                        <option value="">未設定</option>
                                        {warehouses.map(w => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">保管場所（棚）</label>
                                    <input type="text" list="inv-shelf-list" value={form.shelf_code}
                                        onChange={e => setForm(p => ({ ...p, shelf_code: e.target.value }))}
                                        placeholder="A1"
                                        className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-400 outline-none text-sm" />
                                    <datalist id="inv-shelf-list">
                                        {shelfSuggestions.map(s => <option key={s} value={s} />)}
                                    </datalist>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">位置</label>
                                    <input type="number" min="0" value={form.slot_number}
                                        onChange={e => setForm(p => ({ ...p, slot_number: e.target.value }))}
                                        className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-400 outline-none text-sm" />
                                </div>
                            </div>
                            {/* 個数・種類・日付 */}
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">個数</label>
                                    <input type="number" min="0" value={form.quantity}
                                        onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))}
                                        className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-400 outline-none text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">種類</label>
                                    <select value={form.category}
                                        onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                                        className="w-full p-2.5 rounded-lg border border-slate-200 text-sm bg-white">
                                        <option value="">未設定</option>
                                        {INVENTORY_CATEGORY_LIST.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">日付</label>
                                    <input type="date" value={form.recorded_date}
                                        onChange={e => setForm(p => ({ ...p, recorded_date: e.target.value }))}
                                        className="w-full p-2.5 rounded-lg border border-slate-200 text-sm" />
                                </div>
                            </div>
                            {/* 画像 */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">画像（最大3枚）</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {IMAGE_KEYS.map((key, idx) => {
                                        const preview = imagePreviews[key] || form[key];
                                        return (
                                            <div key={key} className="relative aspect-square rounded-lg border-2 border-dashed border-slate-200 overflow-hidden bg-slate-50">
                                                {preview ? (
                                                    <>
                                                        <img src={preview} alt={`画像${idx + 1}`} className="w-full h-full object-cover" />
                                                        <button onClick={() => handleImageClear(key)}
                                                            aria-label={`画像${idx + 1}を削除`} title={`画像${idx + 1}を削除`}
                                                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/60 text-white flex items-center justify-center">
                                                            <X size={14} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer text-slate-300 hover:text-emerald-500 transition">
                                                        <ImageIcon size={22} />
                                                        <span className="text-[10px] font-bold mt-1">画像{idx + 1}</span>
                                                        <input type="file" accept="image/*" className="hidden"
                                                            aria-label={`画像${idx + 1}を選択`}
                                                            onChange={e => { handleImageSelect(key, e.target.files?.[0]); e.target.value = ''; }} />
                                                    </label>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            {/* 登録者表示（編集時） */}
                            {editingId !== 'new' && (() => {
                                const item = items.find(i => i.id === editingId);
                                return item?.recorded_by ? (
                                    <p className="text-xs text-slate-400">登録者: {item.recorded_by}</p>
                                ) : null;
                            })()}
                        </div>

                        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-100 p-4 flex gap-3">
                            {editingId !== 'new' && (
                                <button onClick={handleDelete}
                                    aria-label="この在庫を削除" title="この在庫を削除"
                                    className="p-3 rounded-xl border border-red-200 text-red-600 bg-white hover:bg-red-50 transition active:scale-95">
                                    <Trash2 size={20} />
                                </button>
                            )}
                            <button onClick={closeForm}
                                className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition active:scale-95">
                                キャンセル
                            </button>
                            <button onClick={handleSave} disabled={isSaving}
                                className="flex-1 py-3 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
                                {isSaving && <Loader2 size={16} className="animate-spin" />}
                                保存する
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InventoryApp;
