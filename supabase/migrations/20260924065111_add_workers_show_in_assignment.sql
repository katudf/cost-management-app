-- 配置表への表示・非表示を作業員ごとに設定できるようにする。
-- これまでは worker_type（'事務' 以外を表示）で判定していたが、
-- '管理' でも配置表に出さないケースがあるため、専用フラグに置き換える。
ALTER TABLE public."Workers"
  ADD COLUMN show_in_assignment boolean NOT NULL DEFAULT true;

-- 既存の挙動を維持：事務属性の従業員は非表示で初期化
UPDATE public."Workers" SET show_in_assignment = false WHERE worker_type = '事務';

-- 工程表閲覧（viewer）でも同じ判定を使うため、ビューに列を追加する。
-- CREATE OR REPLACE VIEW は末尾への列追加のみ許されるため最後に置く（権限は維持される）
CREATE OR REPLACE VIEW public.workers_directory AS
  SELECT id, name, display_order, worker_type, resignation_date, show_in_assignment
  FROM public."Workers"
  WHERE is_staff();
