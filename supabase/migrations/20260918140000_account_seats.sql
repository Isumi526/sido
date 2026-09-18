-- ============================================================
--  20260918140000_account_seats.sql
--  契約対応⑧：アカウント数（ログインID数）を数え、基本アカウント数を超えたら警告し、月末の件数を残す
--  Notion: https://app.notion.com/p/3dd0ff81c56b811db298c720d05b7beb
--
--  ★契約（9/17版・別紙1 第3項）: 「アカウントとは、本サービスにログインする利用者（管理者及び作業員）ごとのIDをいい、
--   協力業者ポータルの外部関係者は含まない。アカウント数は各月末日時点の有効なID数による」
--   基本 30（ベーシック/プレミアム共通）・追加1アカウント 月額1,500円・無償試用も30。
--  ★数え方（この関数が正本）: 当該テナントで active な作業員のうち auth_user_id を持つもの
--   ＋ accounts.owner_auth_user_id（作業員行を持たない純オーナー。作業員側に同じ auth_user_id があれば二重に数えない）。
--   協力業者ポータルの外部ユーザーは workers ではないので自然に除外される。
--  ★超過は「ブロックしない」（契約は超過を許し翌月課金）。ここでは数えて残すだけ。
--  ★このマイグレーションは**追加のみ**。
-- ============================================================

-- 基本アカウント数（契約確定値・既定 30）。テナントごとに上書き可
alter table public.accounts add column if not exists base_account_count integer not null default 30;
comment on column public.accounts.base_account_count is
  '契約の基本アカウント数（別紙1 第3項）。これを超えた分が追加課金。既定 30。';

-- 月末時点のアカウント数（請求の根拠）。テナント×年月で1行
create table if not exists public.account_seat_snapshots (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  year_month  text not null,                    -- 'YYYY-MM'（JST）
  seat_count  integer not null,
  base_count  integer not null,                 -- その時点の基本数（後から契約が変わっても請求根拠が動かない）
  counted_at  timestamptz not null default now(),
  constraint account_seat_snapshots_uniq unique (account_id, year_month)
);
comment on table public.account_seat_snapshots is '各月末（JST）時点のアカウント数。追加課金の根拠。';

alter table public.account_seat_snapshots enable row level security;
drop policy if exists account_seat_snapshots_sel on public.account_seat_snapshots;
create policy account_seat_snapshots_sel on public.account_seat_snapshots
  for select to authenticated using (account_id = (select current_account_id()));
revoke all on public.account_seat_snapshots from anon;
revoke insert, update, delete on public.account_seat_snapshots from authenticated;

-- 数える関数（正本）。security definer＝admin の authenticated から呼んでも auth 側を見ずに済む
create or replace function public.count_account_seats(p_account_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(distinct u)::integer from (
    select w.auth_user_id as u
      from public.workers w
     where w.account_id = p_account_id and w.active = true and w.auth_user_id is not null
    union all
    select a.owner_auth_user_id
      from public.accounts a
     where a.id = p_account_id and a.owner_auth_user_id is not null
  ) s where u is not null;
$$;
revoke all on function public.count_account_seats(uuid) from public, anon;
grant execute on function public.count_account_seats(uuid) to authenticated, service_role;

-- 全テナントの月末スナップショット（pg_cron から呼ぶ。手で呼んでも冪等＝同じ年月は上書き）
create or replace function public.snapshot_account_seats(p_year_month text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ym text := coalesce(p_year_month, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'));
  n int := 0;
begin
  insert into public.account_seat_snapshots (account_id, year_month, seat_count, base_count)
  select a.id, ym, public.count_account_seats(a.id), a.base_account_count from public.accounts a
  on conflict (account_id, year_month) do update
    set seat_count = excluded.seat_count, base_count = excluded.base_count, counted_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.snapshot_account_seats(text) from public, anon, authenticated;
grant execute on function public.snapshot_account_seats(text) to service_role;

-- 月末 23:59 JST（=14:59 UTC）。28〜31日に起動し、JST の「明日」が1日の時だけ実行
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('account-seat-snapshot');
exception when others then null;
end $$;
select cron.schedule(
  'account-seat-snapshot',
  '59 14 28-31 * *',
  $cron$
  select public.snapshot_account_seats()
   where extract(day from ((now() at time zone 'Asia/Tokyo') + interval '1 day')) = 1;
  $cron$
);

-- ── ロールバック手順 ──
--   select cron.unschedule('account-seat-snapshot');
--   drop function if exists public.snapshot_account_seats(text);
--   drop function if exists public.count_account_seats(uuid);
--   drop table if exists public.account_seat_snapshots;
--   alter table public.accounts drop column if exists base_account_count;
