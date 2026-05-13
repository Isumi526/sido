-- ============================================================
--  supabase/migrations/20260509500000
--  マスタデータテーブル（現場・作業員・下請け・車両）
-- ============================================================

-- ── 現場マスタ ──────────────────────────────────────────────
create table if not exists sites (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order int not null default 0,
  account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);

alter table sites disable row level security;

-- ── 作業員マスタ ────────────────────────────────────────────
create table if not exists workers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  role       text not null check (role in ('factory', 'site')),
  unit_price int not null default 20000,
  active     boolean not null default true,
  sort_order int not null default 0,
  account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);

alter table workers disable row level security;

-- ── 下請け業者マスタ ────────────────────────────────────────
create table if not exists subcontractors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order int not null default 0,
  account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);

alter table subcontractors disable row level security;

-- ── 車両マスタ ──────────────────────────────────────────────
create table if not exists vehicles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order int not null default 0,
  account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);

alter table vehicles disable row level security;

-- ============================================================
--  サンプル初期データ（実際の作業員名・業者名は管理画面から登録）
-- ============================================================

-- 作業員（工場・事務所）サンプル
insert into workers (name, role, unit_price, sort_order) values
  ('Worker01', 'factory', 30000, 1),
  ('Worker02', 'factory', 23000, 2),
  ('Worker03', 'factory', 23000, 3),
  ('Worker04', 'factory', 20000, 4),
  ('Worker05', 'factory', 20000, 5),
  ('Worker06', 'factory', 20000, 6),
  ('Worker07', 'factory', 20000, 7),
  ('Worker08', 'factory', 20000, 8),
  ('Worker09', 'factory', 20000, 9),
  ('Worker10', 'factory', 20000, 10),
  ('Worker11', 'factory', 20000, 11),
  ('Worker12', 'factory', 20000, 12),
  ('Worker13', 'factory', 20000, 13),
  ('Worker14', 'factory', 20000, 14)
on conflict (name) do nothing;

-- 作業員（現場）サンプル
insert into workers (name, role, unit_price, sort_order) values
  ('Worker15',     'site', 30000, 20),
  ('Worker16',     'site', 30000, 21),
  ('Worker17',     'site', 20000, 22),
  ('Worker18',     'site', 20000, 23),
  ('Worker19',     'site', 20000, 24),
  ('Worker20',     'site', 20000, 25),
  ('Worker21',     'site', 20000, 26),
  ('Worker22',     'site', 20000, 27),
  ('Worker23',     'site', 20000, 28),
  ('Worker24',     'site', 20000, 29),
  ('Worker25',     'site', 20000, 30),
  ('Worker26',     'site', 20000, 31),
  ('Worker27',     'site', 20000, 32),
  ('Worker28',     'site', 20000, 33),
  ('Worker29',     'site', 23000, 34),
  ('Worker30',     'site', 20000, 35),
  ('Worker31',     'site', 23000, 36),
  ('Worker32',     'site', 20000, 37),
  ('Worker33',     'site', 20000, 38),
  ('Worker34',     'site', 20000, 39),
  ('テストユーザー', 'site', 0, 99)
on conflict (name) do nothing;

-- 下請け業者サンプル
insert into subcontractors (name, sort_order) values
  ('VendorA', 1),
  ('VendorB', 2),
  ('VendorC', 3),
  ('VendorD', 4),
  ('VendorE', 5),
  ('VendorF', 6),
  ('VendorG', 7),
  ('VendorH', 8)
on conflict (name) do nothing;

-- 車両サンプル
insert into vehicles (name, sort_order) values
  ('Vehicle01', 1),
  ('Vehicle02', 2),
  ('Vehicle03', 3),
  ('その他',     4)
on conflict (name) do nothing;

-- account_id を初期アカウントで埋める
update workers        set account_id = (select id from accounts where slug = 'seed') where account_id is null;
update subcontractors set account_id = (select id from accounts where slug = 'seed') where account_id is null;
update vehicles       set account_id = (select id from accounts where slug = 'seed') where account_id is null;
