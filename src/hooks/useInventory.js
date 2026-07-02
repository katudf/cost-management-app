import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../components/ConfirmProvider';

const BUCKET = 'inventory-images';

/**
 * 在庫管理（InventoryItems / Warehouses）のデータ取得・CRUD・画像アップロードを担うフック。
 * UIコンポーネントから直接 supabase.from() を呼ばない規約に基づき、在庫関連のDBアクセスはここに集約する。
 */
export function useInventory({ showToast }) {
    const { confirm } = useConfirm();
    const [items, setItems] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [workers, setWorkers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const [whRes, itemRes, wkRes] = await Promise.all([
                supabase.from('Warehouses').select('*')
                    .order('display_order', { ascending: true, nullsFirst: false }),
                supabase.from('InventoryItems').select('*')
                    .order('updated_at', { ascending: false }),
                supabase.from('Workers').select('id, name, resignation_date')
                    .order('display_order', { ascending: true, nullsFirst: false }),
            ]);
            // 一部のテーブルが未作成でも、取得できたデータは反映する
            setWarehouses(whRes.data || []);
            setItems(itemRes.data || []);
            setWorkers((wkRes.data || []).filter(w => w.name && w.name.trim() !== '' && !w.resignation_date));
            const firstError = whRes.error || itemRes.error || wkRes.error;
            if (firstError) throw firstError;
        } catch (e) {
            console.error('在庫データ取得エラー:', e);
            showToast('在庫データの取得に失敗しました', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // 画像をStorageへアップロードして公開URLを返す
    const uploadImage = useCallback(async (file, folder = 'items') => {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file);
        if (error) throw error;
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        return data.publicUrl;
    }, []);

    /**
     * 在庫品目の保存。editingId があれば更新、なければ新規追加。
     * imageFiles: { image_url_1?: File, ... } 差し替える画像だけ File を渡す
     */
    const saveItem = useCallback(async (itemData, editingId = null, imageFiles = {}) => {
        try {
            const payload = { ...itemData };
            for (const [key, file] of Object.entries(imageFiles)) {
                if (file) payload[key] = await uploadImage(file);
            }

            if (editingId) {
                payload.updated_at = new Date().toISOString();
                const { data, error } = await supabase.from('InventoryItems')
                    .update(payload).eq('id', editingId).select();
                if (error) throw error;
                setItems(prev => prev.map(i => (i.id === editingId ? data[0] : i)));
            } else {
                const { data, error } = await supabase.from('InventoryItems')
                    .insert([payload]).select();
                if (error) throw error;
                setItems(prev => [data[0], ...prev]);
            }
            showToast('在庫を保存しました', 'success');
            return true;
        } catch (e) {
            console.error('在庫保存エラー:', e);
            showToast('在庫の保存に失敗しました', 'error');
            return false;
        }
    }, [uploadImage, showToast]);

    const deleteItem = useCallback(async (item) => {
        const ok = await confirm({
            title: '在庫の削除',
            message: `「${item.name}${item.detail ? `（${item.detail}）` : ''}」を削除しますか？`,
            confirmText: '削除する',
        });
        if (!ok) return false;

        const { error } = await supabase.from('InventoryItems').delete().eq('id', item.id);
        if (error) {
            console.error('在庫削除エラー:', error);
            showToast('在庫の削除に失敗しました', 'error');
            return false;
        }
        setItems(prev => prev.filter(i => i.id !== item.id));
        showToast('在庫を削除しました', 'success');
        return true;
    }, [confirm, showToast]);

    // 個数のみのクイック更新（一覧の +/- ボタン用）
    const updateQuantity = useCallback(async (itemId, quantity) => {
        const prevItems = items;
        setItems(prev => prev.map(i => (i.id === itemId ? { ...i, quantity } : i)));
        const { error } = await supabase.from('InventoryItems')
            .update({ quantity, updated_at: new Date().toISOString() }).eq('id', itemId);
        if (error) {
            console.error('個数更新エラー:', error);
            showToast('個数の更新に失敗しました', 'error');
            setItems(prevItems);
        }
    }, [items, showToast]);

    // 倉庫の位置図画像をアップロードして更新
    const uploadWarehouseMap = useCallback(async (warehouseId, file) => {
        try {
            const url = await uploadImage(file, 'maps');
            const { error } = await supabase.from('Warehouses')
                .update({ map_image_url: url, updated_at: new Date().toISOString() })
                .eq('id', warehouseId);
            if (error) throw error;
            setWarehouses(prev => prev.map(w => (w.id === warehouseId ? { ...w, map_image_url: url } : w)));
            showToast('位置図を更新しました', 'success');
            return true;
        } catch (e) {
            console.error('位置図アップロードエラー:', e);
            showToast('位置図のアップロードに失敗しました', 'error');
            return false;
        }
    }, [uploadImage, showToast]);

    return {
        items,
        warehouses,
        workers,
        isLoading,
        fetchAll,
        saveItem,
        deleteItem,
        updateQuantity,
        uploadWarehouseMap,
    };
}
