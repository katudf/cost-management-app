import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * CompanyHolidays（会社の休日・行事）へのアクセスを集約する。
 *
 * 従来は HolidayCalendar / InputTab / AdminApp / WorkerApp /
 * useAssignmentState / useWorkerAssignments の6ファイル12箇所から
 * 直接叩かれていた（取得列も4種類バラバラだった）。ここに一本化する。
 *
 * `description` の意味は DB 上では次のとおり:
 *   - null      … 単なる休日
 *   - それ以外  … 行事名（'会議' / '社員旅行' など）
 * UI 側の「'休日' という表示文字列」や HOLIDAY_TYPES の解釈は
 * 画面ごとの都合なので、このフックには持ち込まない（正規化は呼び出し側）。
 */

/** 全画面で共通の取得列。`*` との差は created_at 等のみで、どの画面も参照していない。 */
const HOLIDAY_COLUMNS = 'id, date, description';

/**
 * 休日データを取得する。エラーは throw する（トーストは呼び出し側の責務）。
 * @param {{from?: string, to?: string}} [range] 省略時は全件。'YYYY-MM-DD'
 * @returns {Promise<Array>}
 */
export async function fetchCompanyHolidays(range = {}) {
    let query = supabase.from('CompanyHolidays').select(HOLIDAY_COLUMNS);
    if (range.from) query = query.gte('date', range.from);
    if (range.to) query = query.lte('date', range.to);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

/**
 * fetchWithCache（{data, error} 形式を期待する）に渡すためのラッパー。
 * @param {{from?: string, to?: string}} [range]
 */
export function fetchCompanyHolidaysResult(range = {}) {
    return fetchCompanyHolidays(range)
        .then(data => ({ data, error: null }))
        .catch(error => ({ data: null, error }));
}

/** 休日を1件削除する。エラーは throw する。 */
export async function deleteCompanyHoliday(id) {
    const { error } = await supabase.from('CompanyHolidays').delete().eq('id', id);
    if (error) throw error;
}

/**
 * 休日を1件保存する。id があれば UPDATE、無ければ INSERT。
 * 保存後の行（id 付き）を返すので、呼び出し側はそれで楽観更新できる。
 * @param {{id?: number, date: string, description: string|null}} holiday
 * @returns {Promise<Object|null>}
 */
export async function upsertCompanyHoliday({ id, date, description = null }) {
    const payload = { date, description };
    const query = id
        ? supabase.from('CompanyHolidays').update(payload).eq('id', id)
        : supabase.from('CompanyHolidays').insert(payload);
    const { data, error } = await query.select(HOLIDAY_COLUMNS);
    if (error) throw error;
    return (data && data.length > 0) ? data[0] : null;
}

/**
 * 休日一覧を state として保持するフック。
 * range を渡すとその期間だけ取得する（省略時は全件）。
 *
 * 取得失敗の通知はトースト等の UI 都合なので、必要な画面だけ
 * `onError` を渡してハンドリングする（渡さなければ console のみ）。
 * `onError` は ref に退避しているので、インラインの関数を渡しても再取得しない。
 *
 * @param {{from?: string, to?: string, onError?: (e: unknown) => void}} [options]
 */
export function useCompanyHolidays(options = {}) {
    const { from, to, onError } = options;
    const [holidays, setHolidays] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const onErrorRef = useRef(onError);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);

    const refetch = useCallback(async () => {
        setIsLoading(true);
        try {
            setHolidays(await fetchCompanyHolidays({ from, to }));
            return true;
        } catch (e) {
            console.error('休日データ取得エラー:', e);
            onErrorRef.current?.(e);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, [from, to]);

    useEffect(() => {
        refetch();
    }, [refetch]);

    return { holidays, setHolidays, isLoading, refetch };
}
