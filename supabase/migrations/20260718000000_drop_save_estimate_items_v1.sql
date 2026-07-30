-- 旧見積明細保存RPC (v1) の削除
-- save_estimate_items_v2 (20260716130000) に置き換え済みで、
-- クライアント側の呼び出し元 (旧Excel取込フロー) も削除されたため、
-- 未使用となったv1関数を削除する。

DROP FUNCTION IF EXISTS public.save_estimate_items(bigint, jsonb);
