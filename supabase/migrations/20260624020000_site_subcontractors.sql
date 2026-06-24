-- ============================================================
--  現場↔下請け業者 の紐付け（n:m）
--  現場ごとに発注している下請け業者を紐づけ、日報の業者プルダウンを現場で絞り込む。
--  追加のみ・後方互換（紐付け無し＝従来どおり全件）。sites.contractor_id（元請け）とは別物。
-- ============================================================
create table if not exists site_subcontractors (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references sites(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  account_id       uuid references accounts(id),
  created_at       timestamptz not null default now(),
  unique (site_id, subcontractor_id)
);
create index if not exists site_sub_site_idx    on site_subcontractors(site_id);
create index if not exists site_sub_sub_idx     on site_subcontractors(subcontractor_id);
create index if not exists site_sub_account_idx on site_subcontractors(account_id);

grant select, insert, update, delete on site_subcontractors to anon, authenticated, service_role;
