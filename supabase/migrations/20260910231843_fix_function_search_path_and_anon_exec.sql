-- =========================================================
-- 指摘E: 関数の search_path 可変性 と anon への EXECUTE 付与を塞ぐ
-- =========================================================
--
-- 【問題1】save_estimate_items_v2 の search_path が可変（advisor: function_search_path_mutable）
--   public スキーマ内の関数で唯一 proconfig が null（search_path 未固定）。
--   本文のテーブル参照は全て public. で修飾済みのため現時点で実害はないが、
--   将来 search_path に攻撃者制御のスキーマが差し込まれた場合に
--   未修飾の演算子・関数解決が乗っ取られうる。他の関数と同様に固定する。
--
-- 【問題2】以下3関数が anon / PUBLIC から実行できる
--   proacl に `=X`（PUBLIC）と `anon=X` が付いており、
--   PostgREST の /rest/v1/rpc/<関数名> から未認証で到達可能。
--   実際に anon キーで叩いた結果:
--     save_estimate_items_v2  -> HTTP 400 P0001（本文に到達し自前の RAISE で停止）
--     overwrite_paste         -> HTTP 204（DELETE+INSERT が anon 権限で実行される。
--                                 Assignments の RLS が {authenticated} のため
--                                 現状は0行だが、匿名で書き込み系が走ること自体が問題）
--     get_next_estimate_seq   -> HTTP 200 "0001"（estimates を読んで採番結果を返す。
--                                 RLS で件数は絞られるが値を返してしまう）
--   いずれも SECURITY INVOKER で最終防波堤は RLS だけ。多層防御として
--   呼び出し口自体を authenticated に限定する。
--   （overwrite_paste はアプリ側に呼び出し元が無い実質デッドコードだが、
--    到達性を残す理由が無いので同様に剥奪する）
--
-- 【対処】
--   1. save_estimate_items_v2 を CREATE OR REPLACE し、
--      ヘッダに `SET search_path TO 'public'` を追加（本文は現物のまま）
--   2. save_estimate_items_v2 / overwrite_paste / get_next_estimate_seq の
--      EXECUTE を anon, PUBLIC から剥奪する。
--      いずれもログイン済みユーザーがフロントから呼ぶため authenticated は残す
--      （save_estimate_items_v2: src/supabaseEstimates.js の見積保存、
--        get_next_estimate_seq: src/supabaseEstimates.js の採番）。
--   CREATE OR REPLACE は既存 ACL を保持するため、REVOKE は再定義の後に置く。


-- ---------------------------------------------------------
-- 1. save_estimate_items_v2 の search_path を固定する
--    （本文は pg_get_functiondef の現物そのまま。ヘッダに SET を1行追加しただけ）
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_estimate_items_v2(p_estimate_id bigint, p_sheets jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet_ids uuid[] := '{}';
  v_sheet_id  uuid;
  v_elem      jsonb;
  v_ord       int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.estimates WHERE id = p_estimate_id) THEN
    RAISE EXCEPTION 'estimate % not found', p_estimate_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_sheets, '[]'::jsonb)) AS t(s)
    JOIN public.estimate_sheets es ON es.id = NULLIF(t.s->>'id', '')::uuid
    WHERE es.estimate_id <> p_estimate_id
  ) THEN
    RAISE EXCEPTION 'sheet does not belong to estimate %', p_estimate_id;
  END IF;

  DELETE FROM public.estimate_sheets es
  WHERE es.estimate_id = p_estimate_id
    AND es.id NOT IN (
      SELECT NULLIF(t.s->>'id', '')::uuid
      FROM jsonb_array_elements(COALESCE(p_sheets, '[]'::jsonb)) AS t(s)
      WHERE NULLIF(t.s->>'id', '') IS NOT NULL
    );

  FOR v_elem IN SELECT s FROM jsonb_array_elements(COALESCE(p_sheets, '[]'::jsonb)) AS t(s)
  LOOP
    v_ord := v_ord + 1;
    v_sheet_id := NULLIF(v_elem->>'id', '')::uuid;
    IF v_sheet_id IS NULL THEN
      INSERT INTO public.estimate_sheets (estimate_id, sort_order, title)
      VALUES (p_estimate_id, v_ord, v_elem->>'title')
      RETURNING id INTO v_sheet_id;
    ELSE
      UPDATE public.estimate_sheets
      SET sort_order = v_ord, title = v_elem->>'title'
      WHERE id = v_sheet_id AND estimate_id = p_estimate_id;
    END IF;
    v_sheet_ids := array_append(v_sheet_ids, v_sheet_id);
  END LOOP;

  DELETE FROM public.estimate_items
  WHERE estimate_id = p_estimate_id;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('sheet_ids', to_jsonb(v_sheet_ids));
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS t(elem)
    WHERE NULLIF(t.elem->>'linked_sheet_index', '') IS NOT NULL
      AND (t.elem->>'linked_sheet_index')::int = (t.elem->>'sheet_index')::int
  ) THEN
    RAISE EXCEPTION 'linked_sheet_index must not reference own sheet';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(elem, ord)
    WHERE NULLIF(t.elem->>'linked_item_index', '') IS NOT NULL
      AND (
        (t.elem->>'linked_item_index')::int = (t.ord - 1)::int
        OR COALESCE((
          SELECT t2.elem2->>'item_type'
          FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t2(elem2, ord2)
          WHERE (t2.ord2 - 1)::int = (t.elem->>'linked_item_index')::int
        ), '') <> 'category'
      )
  ) THEN
    RAISE EXCEPTION 'linked_item_index must reference a category row';
  END IF;

  INSERT INTO public.estimate_items (
    estimate_id,
    sheet_id,
    linked_sheet_id,
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
    v_sheet_ids[NULLIF(t.elem->>'sheet_index', '')::int + 1],
    CASE WHEN NULLIF(t.elem->>'linked_sheet_index', '') IS NOT NULL
         THEN v_sheet_ids[(t.elem->>'linked_sheet_index')::int + 1]
    END,
    (t.ord - 1)::int,
    t.elem->>'item_type',
    t.elem->>'category_symbol',
    COALESCE(t.elem->>'name', ''),
    t.elem->>'spec',
    NULLIF(t.elem->>'quantity', '')::numeric,
    t.elem->>'unit',
    NULLIF(t.elem->>'unit_price', '')::numeric,
    NULLIF(t.elem->>'amount', '')::numeric,
    t.elem->>'note'
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(elem, ord);

  UPDATE public.estimate_items i
  SET linked_category_item_id = tgt.id
  FROM (
    SELECT (t.ord - 1)::int AS idx,
           (t.elem->>'linked_item_index')::int AS linked_idx
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(elem, ord)
    WHERE NULLIF(t.elem->>'linked_item_index', '') IS NOT NULL
  ) src
  JOIN public.estimate_items tgt
    ON tgt.estimate_id = p_estimate_id AND tgt.sort_order = src.linked_idx
  WHERE i.estimate_id = p_estimate_id AND i.sort_order = src.idx;

  RETURN jsonb_build_object('sheet_ids', to_jsonb(v_sheet_ids));
END;
$function$;


-- ---------------------------------------------------------
-- 2. EXECUTE 権限を anon, PUBLIC から剥奪する
--    フロントからログイン済みユーザーが呼ぶため authenticated は残す。
--    CREATE OR REPLACE は既存 ACL を保持するため、上の再定義後に実行する。
-- ---------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.save_estimate_items_v2(bigint, jsonb, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.overwrite_paste(jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_next_estimate_seq(text) FROM anon, PUBLIC;
