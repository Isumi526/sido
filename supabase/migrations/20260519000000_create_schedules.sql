-- ============================================================
--  supabase/migrations/20260519000000
--  予定管理カレンダー
-- ============================================================

create table if not exists schedules (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  worker_id   uuid not null references workers(id) on delete cascade,

  title       text not null,
  description text,
  category    text not null default 'work'
    check (category in ('work', 'off', 'training', 'meeting', 'other')),
  site_id     uuid references sites(id) on delete set null,

  -- 色（null の場合はカテゴリ既定色）
  color       text,

  -- 日時
  all_day     boolean not null default true,
  start_date  date not null,
  end_date    date not null,
  start_time  time,
  end_time    time,

  -- 繰り返し（将来実装用）
  recurrence_rule text,

  -- 作成者
  created_by_line_user_id text,
  created_by_admin_id     uuid,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  check (end_date >= start_date)
);

alter table schedules disable row level security;

create index if not exists schedules_account_date_idx
  on schedules(account_id, start_date, end_date);

create index if not exists schedules_worker_id_idx
  on schedules(worker_id);
