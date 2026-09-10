-- 見積WYSIWYGエディタ: シートモデル導入（フェーズ1a・加算のみ）
-- docs/estimate_wysiwyg_editor/design.md §5 参照
-- 適用済み: 2026-07-16 に本番へ apply_migration (add_estimate_sheets_and_links)

-- 1) 新テーブル estimate_sheets
create table public.estimate_sheets (
  id uuid primary key default gen_random_uuid(),
  estimate_id bigint not null references public.estimates(id) on delete cascade,
  sort_order integer not null default 1,
  title text,
  created_at timestamptz not null default now()
);

create index estimate_sheets_estimate_id_idx on public.estimate_sheets(estimate_id);

-- RLS: estimate_items と同等（事務/管理者のみ全操作可）
alter table public.estimate_sheets enable row level security;

create policy estimate_sheets_office_all on public.estimate_sheets
  for all to authenticated
  using (is_admin() or current_staff_role() = 'office')
  with check (is_admin() or current_staff_role() = 'office');

-- 2) estimate_items にシート・リンク列を追加（全てNULL可、既存動作に影響なし）
alter table public.estimate_items
  add column sheet_id uuid references public.estimate_sheets(id) on delete cascade,
  add column linked_sheet_id uuid references public.estimate_sheets(id) on delete set null,
  add column linked_category_item_id bigint references public.estimate_items(id) on delete set null;

create index estimate_items_sheet_id_idx on public.estimate_items(sheet_id);

-- 3) バックフィル: 既存見積（削除済み含む）ごとにトップシートを1行生成し、全明細を帰属させる
insert into public.estimate_sheets (estimate_id, sort_order)
select id, 1 from public.estimates;

update public.estimate_items i
set sheet_id = s.id
from public.estimate_sheets s
where s.estimate_id = i.estimate_id
  and s.sort_order = 1
  and i.sheet_id is null;
