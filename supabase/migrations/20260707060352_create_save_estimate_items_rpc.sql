-- 見積明細の一括保存を1トランザクションで実行するRPC
-- 従来はクライアント側で「全削除 → 再挿入」の2段階だったため、
-- 削除成功後に挿入が失敗すると明細が全損するリスクがあった。
-- この関数は delete + insert を単一トランザクション内で実行し、
-- いずれかが失敗した場合は全体をロールバックする。
--
-- 引数:
--   p_estimate_id : 対象の見積書ID
--   p_items       : 明細のJSONB配列（sort_orderは配列順で振り直す）
--
-- p_items の各要素で参照するキー:
--   parent_id, item_type, category_symbol, name, spec,
--   quantity, unit, unit_price, amount, note

CREATE OR REPLACE FUNCTION public.save_estimate_items(
  p_estimate_id bigint,
  p_items       jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  -- 既存明細を全削除
  DELETE FROM public.estimate_items
  WHERE estimate_id = p_estimate_id;

  -- 空配列なら削除のみで終了
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN;
  END IF;

  -- JSONB配列を展開して一括挿入。sort_order は配列順（ordinality）で振り直す。
  INSERT INTO public.estimate_items (
    estimate_id,
    parent_id,
    sort_order,
    item_type,
    category_symbol,
    name,
    spec,
    quantity,
    unit,
    unit_price,
    amount,
    note
  )
  SELECT
    p_estimate_id,
    NULLIF(elem->>'parent_id', '')::bigint,
    (ord - 1)::int,
    elem->>'item_type',
    elem->>'category_symbol',
    COALESCE(elem->>'name', ''),
    elem->>'spec',
    NULLIF(elem->>'quantity', '')::numeric,
    elem->>'unit',
    NULLIF(elem->>'unit_price', '')::numeric,
    NULLIF(elem->>'amount', '')::numeric,
    elem->>'note'
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(elem, ord);
END;
$function$;
