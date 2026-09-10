-- 見積明細＋シートの一括保存RPC v2（フェーズ1b）
-- docs/estimate_wysiwyg_editor/design.md §5「保存方式とIDの安定化」参照
--
-- 旧 save_estimate_items は delete+insert で行IDが毎回振り直されるため、
-- 自己参照FK linked_category_item_id が保存のたびに壊れる。
-- v2 はリンクを「配列インデックス（一時キー）」で受け取り、INSERT後に
-- 新IDへ再マップする2パス方式。シートは UPSERT でIDを安定させる。
-- 旧RPCは旧エディタ・Excel取込が使うため移行完了（フェーズ7）まで温存する。
--
-- 引数:
--   p_estimate_id : 対象の見積書ID
--   p_sheets      : シートのJSONB配列（配列順=シート順、先頭=トップシート）
--                   各要素: { id: uuid|null（null=新規）, title: text|null }
--   p_items       : 明細のJSONB配列（sort_orderは配列順で振り直す）
--                   各要素: { sheet_index: int（p_sheetsのインデックス）,
--                            linked_sheet_index: int|null（①シート合計リンク）,
--                            linked_item_index: int|null（②カテゴリ合計リンク。
--                              p_items内のカテゴリ行インデックス）,
--                            item_type, category_symbol, name, spec,
--                            quantity, unit, unit_price, amount, note }
-- 戻り値: { "sheet_ids": [uuid, ...] }（p_sheets と同順の確定シートID）

CREATE OR REPLACE FUNCTION public.save_estimate_items_v2(
  p_estimate_id bigint,
  p_sheets      jsonb,
  p_items       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_sheet_ids uuid[] := '{}';
  v_sheet_id  uuid;
  v_elem      jsonb;
  v_ord       int := 0;
BEGIN
  -- 見積の存在確認（RLS適用下で見えない場合もhere）
  IF NOT EXISTS (SELECT 1 FROM public.estimates WHERE id = p_estimate_id) THEN
    RAISE EXCEPTION 'estimate % not found', p_estimate_id;
  END IF;

  -- 他見積のシートIDの混入を拒否
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_sheets, '[]'::jsonb)) AS t(s)
    JOIN public.estimate_sheets es ON es.id = NULLIF(t.s->>'id', '')::uuid
    WHERE es.estimate_id <> p_estimate_id
  ) THEN
    RAISE EXCEPTION 'sheet does not belong to estimate %', p_estimate_id;
  END IF;

  -- 提示されなかった既存シートを削除（所属明細はCASCADE、他行の linked_sheet_id は SET NULL）
  DELETE FROM public.estimate_sheets es
  WHERE es.estimate_id = p_estimate_id
    AND es.id NOT IN (
      SELECT NULLIF(t.s->>'id', '')::uuid
      FROM jsonb_array_elements(COALESCE(p_sheets, '[]'::jsonb)) AS t(s)
      WHERE NULLIF(t.s->>'id', '') IS NOT NULL
    );

  -- シートを配列順にUPSERT（id指定あり=更新、なし=新規）。IDを配列順に収集
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

  -- 既存明細を全削除（行IDは振り直し。リンクはインデックスで再構築するため安全）
  DELETE FROM public.estimate_items
  WHERE estimate_id = p_estimate_id;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('sheet_ids', to_jsonb(v_sheet_ids));
  END IF;

  -- 最低限のリンク検証（詳細な循環参照チェックはクライアント側）
  -- ①自シートへのシート合計リンク禁止
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS t(elem)
    WHERE NULLIF(t.elem->>'linked_sheet_index', '') IS NOT NULL
      AND (t.elem->>'linked_sheet_index')::int = (t.elem->>'sheet_index')::int
  ) THEN
    RAISE EXCEPTION 'linked_sheet_index must not reference own sheet';
  END IF;
  -- ②カテゴリ合計リンクは自行以外のカテゴリ行のみ参照可
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

  -- 1パス目: 明細を一括挿入。sort_order=配列順。シート参照はインデックス→確定IDで解決
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

  -- 2パス目: カテゴリ合計リンクを新IDへ再マップ（sort_order=配列インデックスを媒介に）
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
