-- ============================================================
--  休み・有給を予定に先入れし、その日の日報を自動で出す（2026-10-02 設計「入力の手間を減らす」I-3・要望7）
--
--  1. worker_weekly_days_off … 作業員さんが一度決める「毎週◯曜は休み」（確認事項3=A）。読み書きは EF(days-off) のみ
--  2. daily_reports.auto_submitted … 休みの予定から自動で出した日報の印（管理画面で見分けるため）
--  3. schedule_categories に「有給」（key=paid_leave）を足す（休み＝off は既にある）
--  4. pg_cron: 毎晩 20:00(JST) に auto-day-off-reports を呼ぶ（その日の出勤の打刻があれば出さない＝確認事項2=B）
--  ★追加のみ（既存の行・列は変えない）
-- ============================================================

create table if not exists public.worker_weekly_days_off (
  account_id uuid not null references public.accounts(id) on delete cascade,
  worker_id  uuid not null references public.workers(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),   -- 0=日 … 6=土
  created_at timestamptz not null default now(),
  primary key (worker_id, weekday)
);
create index if not exists worker_weekly_days_off_account_idx on public.worker_weekly_days_off (account_id, weekday);
alter table public.worker_weekly_days_off enable row level security;
revoke all on table public.worker_weekly_days_off from anon, authenticated;
comment on table public.worker_weekly_days_off is
  '作業員の毎週の定休（I-3）。この曜日は休みの予定と同じ扱い（日報を自動で出す）。読み書きは EF(service_role) のみ';

alter table public.daily_reports add column if not exists auto_submitted boolean not null default false;
comment on column public.daily_reports.auto_submitted is
  '休み・有給の予定から自動で出した日報（I-3）。直しは通常の日報の編集と同じ';

insert into public.schedule_categories (account_id, key, label, color, sort_order, active)
select a.id, 'paid_leave', '有給', '#7C3AED', 90, true
from public.accounts a
on conflict (account_id, key) do nothing;

create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('auto-day-off-reports');
exception when others then null;
end $$;

-- 20:00 JST = 11:00 UTC
select cron.schedule(
  'auto-day-off-reports',
  '0 11 * * *',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/auto-day-off-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

-- ↩ ロールバック: select cron.unschedule('auto-day-off-reports');
--   新しい表 worker_weekly_days_off と列 daily_reports.auto_submitted は消さなくても既存の動きに影響しない。
--   schedule_categories の paid_leave 行は、使った予定が無ければ消してよい（戻しの SQL は人が書く）
