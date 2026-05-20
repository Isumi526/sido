-- ============================================================
--  予定グループ共有機能（再適用）
-- ============================================================

alter table schedules add column if not exists is_public boolean not null default true;

create table if not exists schedule_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references workers(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table schedule_groups disable row level security;

create table if not exists schedule_group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references schedule_groups(id) on delete cascade,
  worker_id  uuid not null references workers(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  unique (group_id, worker_id)
);
alter table schedule_group_members disable row level security;

create table if not exists schedule_group_shares (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules(id) on delete cascade,
  group_id    uuid not null references schedule_groups(id) on delete cascade,
  unique (schedule_id, group_id)
);
alter table schedule_group_shares disable row level security;

create index if not exists sgs_schedule_idx on schedule_group_shares(schedule_id);
create index if not exists sgs_group_idx    on schedule_group_shares(group_id);
create index if not exists sgm_worker_idx   on schedule_group_members(worker_id);
create index if not exists sgm_group_idx    on schedule_group_members(group_id);
