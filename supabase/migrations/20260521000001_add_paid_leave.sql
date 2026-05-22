-- workers に有給管理用の列を追加
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS hire_date          date,
  ADD COLUMN IF NOT EXISTS employment_type    text check (employment_type in ('fulltime', 'parttime')) default 'fulltime',
  ADD COLUMN IF NOT EXISTS weekly_scheduled_days smallint;  -- パートのみ: 週所定労働日数

-- 有給付与台帳
CREATE TABLE IF NOT EXISTS paid_leave_grants (
  id          uuid        primary key default gen_random_uuid(),
  worker_id   uuid        not null references workers(id)  on delete cascade,
  account_id  uuid        not null references accounts(id) on delete cascade,
  granted_at  date        not null,
  expires_at  date        not null,
  days        numeric(4,1) not null check (days > 0),
  note        text,
  created_at  timestamptz not null default now()
);

ALTER TABLE paid_leave_grants disable row level security;
