import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * PurchaseRecords（購買台帳・仕入帳）のデータアクセスを集約するフック。
 *
 * `PurchaseLedgerTab.jsx` に直書きされていた supabase 呼び出し6箇所を集約したもの。
 * このテーブルを触るのは同ファイルだけなので、重複の統合は発生しない。
 *
 * 規約（手順2で確立）:
 * - エラーは throw する。**トースト通知・ローディング表示は呼び出し側の責務**。
 * - フォーム入力の都合（空文字 `''` → `null` の正規化、必須項目チェック）は
 *   テーブルの都合ではないので**呼び出し側に残す**。フックは渡された行をそのまま書く。
 *
 * CSV の一括登録は、チャンクごとの失敗を取込結果サマリに集計する必要があるため、
 * ループと集計は呼び出し側に置き、ここには throw する素の insert のみを置く。
 */

/** 1回の SELECT で取得する件数（ページング単位） */
const FETCH_PAGE_SIZE = 1000;

/**
 * 仕入帳の全件を取得する（1000件ずつページングして連結）。
 * @returns {Promise<Array<object>>} id 昇順の全レコード
 */
const fetchPurchaseRecords = async () => {
    let allRecords = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from('PurchaseRecords')
            .select('*')
            .order('id', { ascending: true })
            .range(from, from + FETCH_PAGE_SIZE - 1);

        if (error) throw error;

        if (data && data.length > 0) {
            allRecords = [...allRecords, ...data];
            if (data.length < FETCH_PAGE_SIZE) break;
            from += FETCH_PAGE_SIZE;
        } else {
            break;
        }
    }

    return allRecords;
};

/**
 * 仕入帳に1件登録し、登録後の行を返す。
 * @param {object} record 登録する行（正規化済みであること）
 * @returns {Promise<object|null>} 登録された行
 */
export const insertPurchaseRecord = async (record) => {
    const { data, error } = await supabase
        .from('PurchaseRecords')
        .insert([record])
        .select();

    if (error) throw error;
    return data ? data[0] : null;
};

/**
 * 仕入帳に複数件をまとめて登録する（CSV取込用）。
 * チャンク分割と失敗の集計は呼び出し側の責務。
 * @param {Array<object>} records 登録する行の配列
 */
export const insertPurchaseRecords = async (records) => {
    const { error } = await supabase
        .from('PurchaseRecords')
        .insert(records);

    if (error) throw error;
};

/**
 * 仕入帳の1件を更新し、更新後の行を返す。
 * @param {number} id 対象の id
 * @param {object} updates 更新する列（`id` / `created_at` は含めないこと）
 * @returns {Promise<object|null>} 更新された行
 */
export const updatePurchaseRecord = async (id, updates) => {
    const { data, error } = await supabase
        .from('PurchaseRecords')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) throw error;
    return data ? data[0] : null;
};

/**
 * 仕入帳の1件を削除する。
 * @param {number} id 対象の id
 */
export const deletePurchaseRecord = async (id) => {
    const { error } = await supabase
        .from('PurchaseRecords')
        .delete()
        .eq('id', id);

    if (error) throw error;
};

/**
 * 仕入帳の複数件をまとめて削除する。
 * @param {Array<number>} ids 対象の id 配列
 */
export const deletePurchaseRecords = async (ids) => {
    const { error } = await supabase
        .from('PurchaseRecords')
        .delete()
        .in('id', ids);

    if (error) throw error;
};

/**
 * 仕入帳の一覧を保持する状態付きフック。
 * マウント時に自動で取得する。
 *
 * @param {object} [options]
 * @param {(error: Error) => void} [options.onError] 取得失敗時に呼ばれる
 * @returns {{records: Array<object>, setRecords: Function, isLoading: boolean, refetch: Function}}
 */
export const usePurchaseLedger = (options = {}) => {
    const { onError } = options;
    const [records, setRecords] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    // インラインで渡されたコールバックが毎回 refetch を作り直さないよう ref に逃がす
    const onErrorRef = useRef(onError);
    useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    const refetch = useCallback(async () => {
        try {
            setIsLoading(true);
            const data = await fetchPurchaseRecords();
            setRecords(data);
            return data;
        } catch (error) {
            console.error(error);
            if (onErrorRef.current) onErrorRef.current(error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refetch().catch(() => { /* onError で通知済み */ });
    }, [refetch]);

    return { records, setRecords, isLoading, refetch };
};
