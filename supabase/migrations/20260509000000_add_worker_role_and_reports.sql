-- ============================================================
--  worker_role / sites / daily_reports
-- ============================================================

-- expense_users に所属（役割）カラム追加
alter table expense_users
  add column if not exists worker_role text not null default 'site'
    check (worker_role in ('factory', 'site'));

-- 現場マスタ（将来の脱スプシに向けて先行作成）
create table if not exists sites (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  is_active  boolean not null default true,
  created_at timestamptz default now()
);

-- 日報（全データをSupabaseに保存 → 管理画面用）
-- sites カラムに現場・稼働・経費データをJSONBで保持（柔軟性重視）
create table if not exists daily_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references expense_users(id) not null,
  date       date not null,
  is_working boolean not null default true,
  sites      jsonb not null default '[]',
  note       text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint daily_reports_user_date_unique unique (user_id, date)
);

create index if not exists daily_reports_user_id_idx on daily_reports(user_id);
create index if not exists daily_reports_date_idx    on daily_reports(date);

alter table sites         disable row level security;
alter table daily_reports disable row level security;
