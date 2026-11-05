/**
 * PostgREST の取得上限（supabase/config.toml の max_rows = 1000）を超える件数を、
 * range() でページを分けてすべて取得する。
 *
 * buildQuery は呼ぶたびに新しいクエリを返す関数にすること（クエリビルダーは使い回せない）。
 * ページ境界で行が重複・欠落しないよう、並び順は一意に決まるもの（末尾に id など）を指定すること。
 *
 * @param {() => import('@supabase/postgrest-js').PostgrestFilterBuilder} buildQuery
 * @param {number} [pageSize=1000]
 * @returns {Promise<{ data: object[] | null, error: object | null }>} supabase-js と同じ形で返す
 */
export async function fetchAllPages(buildQuery, pageSize = 1000) {
    const all = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await buildQuery().range(from, from + pageSize - 1);
        if (error) return { data: null, error };
        const rows = data || [];
        all.push(...rows);
        if (rows.length < pageSize) break;
    }
    return { data: all, error: null };
}
