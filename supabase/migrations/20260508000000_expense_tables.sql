-- ============================================================
--  経費申請テーブル
-- ============================================================

-- ユーザー登録テーブル（LINE名と本名の紐付け）
create table if not exists expense_users (
  id           uuid primary key default gen_random_uuid(),
  line_user_id text unique not null,
  real_name    text not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 経費明細テーブル
create table if not exists expense_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references expense_users(id) on delete cascade not null,
  date                date not null,
  payee               text not null,         -- 支払先
  registration_number text,                  -- 登録番号（インボイス）
  category            text not null,         -- 品名
  liters              numeric,               -- ℓ（ガソリン代・軽油代のみ）
  site_name           text,                  -- 現場名
  amount              integer not null,      -- 金額（円）
  period_key          text not null,         -- 例: '2026-05-first' | '2026-05-second'
  created_at          timestamptz default now()
);

create index if not exists expense_items_user_period_idx
  on expense_items(user_id, period_key);

create index if not exists expense_items_period_idx
  on expense_items(period_key);
