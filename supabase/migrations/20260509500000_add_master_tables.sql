-- ============================================================
--  supabase/migrations/20260509500000
--  マスタデータテーブル（現場・作業員・下請け・車両）
--  スプレッドシートの「設定シート」をSupabaseに移行
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
--  初期データ（useMaster.ts の FALLBACK データを元に投入）
-- ============================================================

-- 作業員（工場・事務所）
insert into workers (name, role, unit_price, sort_order) values
  ('今井',   'factory', 30000, 1),
  ('伊藤',   'factory', 23000, 2),
  ('野村',   'factory', 23000, 3),
  ('毛利',   'factory', 20000, 4),
  ('鵜飼',   'factory', 20000, 5),
  ('相馬',   'factory', 20000, 6),
  ('Worker07', 'factory', 20000, 7),
  ('前田',   'factory', 20000, 8),
  ('ジェイ', 'factory', 20000, 9),
  ('ヌル',   'factory', 20000, 10),
  ('デデ',   'factory', 20000, 11),
  ('アチェ', 'factory', 20000, 12),
  ('平床',   'factory', 20000, 13),
  ('作長',   'factory', 20000, 14)
on conflict (name) do nothing;

-- 作業員（現場）
insert into workers (name, role, unit_price, sort_order) values
  ('大塚',       'site', 30000, 20),
  ('小島',       'site', 30000, 21),
  ('山本',       'site', 20000, 22),
  ('Worker18',       'site', 20000, 23),
  ('Worker19', 'site', 20000, 24),
  ('アリフ',     'site', 20000, 25),
  ('Worker21',   'site', 20000, 26),
  ('ハイ',       'site', 20000, 27),
  ('ガイ',       'site', 20000, 28),
  ('辻',         'site', 20000, 29),
  ('佐藤',       'site', 20000, 30),
  ('さや',       'site', 20000, 31),
  ('片岡',       'site', 20000, 32),
  ('Worker28',       'site', 20000, 33),
  ('浅野',       'site', 23000, 34),
  ('横井',       'site', 20000, 35),
  ('白石',       'site', 23000, 36),
  ('香田',       'site', 20000, 37),
  ('Worker33',       'site', 20000, 38),
  ('Worker34',       'site', 20000, 39),
  ('テストユーザー', 'site', 0, 99)
on conflict (name) do nothing;

-- 下請け業者
insert into subcontractors (name, sort_order) values
  ('VendorA', 1),
  ('VendorB',       2),
  ('VendorC',            3),
  ('VendorD',       4),
  ('VendorE',         5),
  ('VendorF',     6),
  ('VendorG',       7),
  ('VendorH',     8)
on conflict (name) do nothing;

-- 車両
insert into vehicles (name, sort_order) values
  ('ハイエース',   1),
  ('キャラバン',   2),
  ('プロボックス', 3),
  ('その他',       4)
on conflict (name) do nothing;

-- account_id を seed アカウントで埋める
update workers       set account_id = (select id from accounts where slug = 'seed') where account_id is null;
update subcontractors set account_id = (select id from accounts where slug = 'seed') where account_id is null;
update vehicles      set account_id = (select id from accounts where slug = 'seed') where account_id is null;
