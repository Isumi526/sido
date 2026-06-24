-- ============================================================
--  作業員の昇給（単価変更）履歴
--  単価(unit_price)変更時に1行記録し、作業員詳細で履歴参照できる。
--  集計の単価参照は現行どおり最新（履歴は記録のみ）＝後方互換・追加のみ。
-- ============================================================
create table if not exists worker_wage_history (
  id             uuid primary key default gen_random_uuid(),
  worker_id      uuid not null references workers(id) on delete cascade,
  account_id     uuid references accounts(id),
  old_unit_price integer,
  new_unit_price integer not null,
  reason         text,
  changed_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists wage_history_worker_idx  on worker_wage_history(worker_id);
create index if not exists wage_history_account_idx on worker_wage_history(account_id);

grant select, insert, update, delete on worker_wage_history to anon, authenticated, service_role;
