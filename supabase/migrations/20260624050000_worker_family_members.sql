-- ============================================================
--  作業員の家族構成（氏名・続柄・生年月日）
--  作業員1人に複数の家族メンバー（1:n）。追加のみ・自己完結。
--  機微個人情報のため account_id でテナント分離（マスタ層は親エピックで一括RLS化）。
-- ============================================================
create table if not exists worker_family_members (
  id           uuid primary key default gen_random_uuid(),
  worker_id    uuid not null references workers(id) on delete cascade,
  account_id   uuid references accounts(id),
  name         text not null,
  relationship text,
  birth_date   date,
  note         text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists wfm_worker_idx  on worker_family_members(worker_id);
create index if not exists wfm_account_idx on worker_family_members(account_id);

grant select, insert, update, delete on worker_family_members to anon, authenticated, service_role;
