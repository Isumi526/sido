-- ============================================================
--  20260626010000_process_tasks.sql
--  工程管理（土台・ガント簡易版／回答A: 現場×工程(タスク)×期間 開始/終了/担当/進捗）。
--   - process_tasks: 現場ごとの工程タスク。開始/終了日・担当者・進捗% を持ち、
--     admin の工程管理画面でガント風に表示・編集する。
--   - schedules(予定/カレンダー)とは別entity（回答Aは専用の工程テーブル）。
--   - admin(authenticated)のみ操作。account スコープの RLS（estimate_comments と同方針）。
--  追加のみDDL（CREATE TABLE / INDEX / POLICY）。破壊的変更なし。
--  ※ current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み。
-- ============================================================

create table if not exists public.process_tasks (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  site_id     uuid references sites(id) not null,
  name        text not null,                         -- 工程/タスク名（例: 内装ボード）
  assignee    text,                                  -- 担当者名（自由入力）
  start_date  date,
  end_date    date,
  progress    int not null default 0,                -- 進捗 0-100
  sort_order  int not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists process_tasks_account_idx on public.process_tasks (account_id);
create index if not exists process_tasks_site_idx    on public.process_tasks (site_id);

alter table public.process_tasks enable row level security;
create policy pt_sel on public.process_tasks for select to authenticated
  using (account_id = (select public.current_account_id()));
create policy pt_ins on public.process_tasks for insert to authenticated
  with check (account_id = (select public.current_account_id()));
create policy pt_upd on public.process_tasks for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));
create policy pt_del on public.process_tasks for delete to authenticated
  using (account_id = (select public.current_account_id()));
revoke all on public.process_tasks from anon;
