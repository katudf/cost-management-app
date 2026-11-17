-- 見積明細の品名入力補完（docs/estimate_wysiwyg_editor/design.md §6）
--
-- 過去の見積明細から、品名に p_query を含む行を「品名＋仕様＋単位」ごとにまとめ、
-- 一番新しい見積（発行日→作成日→ID の順）の単価と、使用回数・最終使用日を返す。
--
-- 対象外: 削除済み（ゴミ箱）の見積、工種行・小計行・固定行、コメント行・空行
--        （item_type='item' + category_symbol のセンチネル）、リンク行、品名が空の行。
-- 権限:  SECURITY INVOKER（呼び出したユーザーの RLS がそのまま効く。estimates / estimate_items を
--        読めないロールには何も返らない）。anon・PUBLIC からは実行権限を外す。

CREATE OR REPLACE FUNCTION public.search_estimate_item_suggestions(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE (
  name text,
  spec text,
  unit text,
  unit_price numeric,
  use_count bigint,
  last_used date
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT btrim(coalesce(p_query, '')) AS s
  ),
  src AS (
    SELECT
      btrim(i.name)                   AS name,
      coalesce(btrim(i.spec), '')     AS spec,
      coalesce(btrim(i.unit), '')     AS unit,
      i.unit_price::numeric           AS unit_price,
      e.issue_date::date              AS issue_date,
      i.created_at,
      i.id
    FROM public.estimate_items i
    JOIN public.estimates e ON e.id = i.estimate_id
    CROSS JOIN q
    WHERE char_length(q.s) >= 2
      AND e.deleted_at IS NULL
      AND i.item_type = 'item'
      AND (i.category_symbol IS NULL OR i.category_symbol NOT IN ('__comment__', '__blank__'))
      AND i.linked_sheet_id IS NULL
      AND i.linked_category_item_id IS NULL
      AND btrim(coalesce(i.name, '')) <> ''
      AND strpos(lower(i.name), lower(q.s)) > 0
  ),
  grouped AS (
    SELECT DISTINCT ON (name, spec, unit)
      name, spec, unit, unit_price,
      issue_date AS last_used,
      count(*) OVER (PARTITION BY name, spec, unit) AS use_count
    FROM src
    ORDER BY name, spec, unit, issue_date DESC NULLS LAST, created_at DESC, id DESC
  )
  SELECT g.name, g.spec, g.unit, g.unit_price, g.use_count, g.last_used
  FROM grouped g
  ORDER BY g.last_used DESC NULLS LAST, g.use_count DESC, g.name
  LIMIT least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.search_estimate_item_suggestions(text, integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_estimate_item_suggestions(text, integer) TO authenticated;
