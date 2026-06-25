-- ============================================================
--  作業員マスタ拡張: 会社情報/インボイス/保険/労災番号 ＋ 車検・健診履歴
--  追加のみ（ADD COLUMN / CREATE TABLE / CREATE INDEX / GRANT）。
--  労災保険番号は区分=業務委託のみ表示（表示制御はUI側）。
--  機微個人情報のため account_id でテナント分離（マスタ層は親エピックで一括RLS化）。
-- ============================================================

-- 1) workers への追加列（会社情報・インボイス登録番号・会社の保険・労災保険番号）
alter table workers add column if not exists company_info           text;
alter table workers add column if not exists invoice_number         text;  -- インボイス登録番号
alter table workers add column if not exists insurance_info         text;  -- 会社の保険
alter table workers add column if not exists labor_insurance_number text;  -- 労災保険番号（区分=業務委託）

-- 2) 車検履歴（1作業員に複数）
create table if not exists worker_vehicle_inspections (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references workers(id) on delete cascade,
  account_id      uuid references accounts(id),
  vehicle_name    text,
  inspection_date date,
  expiry_date     date,
  note            text,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists wvi_worker_idx  on worker_vehicle_inspections(worker_id);
create index if not exists wvi_account_idx on worker_vehicle_inspections(account_id);

-- 3) 健康診断履歴（1作業員に複数）
create table if not exists worker_health_checkups (
  id           uuid primary key default gen_random_uuid(),
  worker_id    uuid not null references workers(id) on delete cascade,
  account_id   uuid references accounts(id),
  checkup_date date,
  result       text,
  note         text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists whc_worker_idx  on worker_health_checkups(worker_id);
create index if not exists whc_account_idx on worker_health_checkups(account_id);

grant select, insert, update, delete on worker_vehicle_inspections to anon, authenticated, service_role;
grant select, insert, update, delete on worker_health_checkups     to anon, authenticated, service_role;
