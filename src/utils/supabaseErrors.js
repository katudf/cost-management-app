/**
 * DB（Supabase / PostgREST）の更新より画面が先に新しくなったときの判定。
 * PWA のキャッシュと本番への反映の順番の都合で、画面が新しい DB 関数・ビューを先に呼ぶことがある。
 * そのときは旧方式に戻して動かし続けるために使う。
 */

/**
 * 名前・引数の組が合う DB 関数が無い（新しい引数を足したマイグレーションの適用前など）。
 * PostgREST は PGRST202 を返す。
 */
export const isMissingRpcError = (error) => error?.code === 'PGRST202';

/**
 * テーブル・ビューが無い（ビューを足したマイグレーションの適用前など）。
 * PostgREST はスキーマのキャッシュに無ければ PGRST205、DB まで届けば 42P01 を返す。
 */
export const isMissingRelationError = (error) => error?.code === 'PGRST205' || error?.code === '42P01';
