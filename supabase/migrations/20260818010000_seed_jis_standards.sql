-- 日本ペイント設計価格表 p.5-6「塗装略号・JIS 規格一覧表」に掲載された JIS 規格を登録する。
-- 併せて、規格番号が判明した製品を paint_product_standards に紐づけ、
-- 暫定行「JIS 規格番号未確認」からの紐付けを解除する。

insert into public.paint_standards (standard_type, code, name, is_abolished, sort_order)
values
  ('JIS', 'A 6021', '建築用塗膜防水材', false, 10),
  ('JIS', 'A 6909', '建築用仕上塗材', false, 20),
  ('JIS', 'A 6916', '建築用下地調整塗材', false, 30),
  ('JIS', 'K 5492', 'アルミニウムペイント', false, 40),
  ('JIS', 'K 5516', '合成樹脂調合ペイント', false, 50),
  ('JIS', 'K 5551', '構造物用さび止めペイント', false, 60),
  ('JIS', 'K 5552', 'ジンクリッチプライマー', false, 70),
  ('JIS', 'K 5553', '厚膜型ジンクリッチペイント', false, 80),
  ('JIS', 'K 5572', 'フタル酸樹脂エナメル', false, 90),
  ('JIS', 'K 5582', '塩化ビニル樹脂エナメル', false, 100),
  ('JIS', 'K 5621', '一般用さび止めペイント', false, 110),
  ('JIS', 'K 5633', 'エッチングプライマー', false, 120),
  ('JIS', 'K 5651', 'アミノアルキド樹脂塗料', false, 130),
  ('JIS', 'K 5658', '建築用耐候性上塗り塗料', false, 140),
  ('JIS', 'K 5659', '鋼構造物用耐候性塗料', false, 150),
  ('JIS', 'K 5660', 'つや有り合成樹脂エマルションペイント', false, 160),
  ('JIS', 'K 5663', '合成樹脂エマルションペイント', false, 170),
  ('JIS', 'K 5665', '路面表示用塗料', false, 180),
  ('JIS', 'K 5668', '合成樹脂エマルション模様塗料', false, 190),
  ('JIS', 'K 5669', '合成樹脂エマルションパテ', false, 200),
  ('JIS', 'K 5670', 'アクリル樹脂系非水分散形塗料', false, 210),
  ('JIS', 'K 5674', '鉛・クロムフリーさび止めペイント', false, 220),
  ('JIS', 'K 5675', '屋根用高日射反射率塗料', false, 230),
  ('JIS', 'K 5970', '建築用床塗料', false, 240)
on conflict (standard_type, code) do update
  set name = excluded.name,
      sort_order = excluded.sort_order,
      updated_at = now();

-- 製品との紐付けは MD 一括登録の `- 規格:` 行から行うため、ここでは行わない。
-- 暫定行「JIS 規格番号未確認」は、規格番号が判明した製品から個別に付け替える運用とする。
