-- ============================================================
--  20260920160000_schedule_mail_notify.sql
--  スケジュール管理の通知をメールで完成させる（予定の作成・変更・削除＋前日リマインド、テナント/作業員 ON/OFF）
--
--  ★追加のみ:
--   1. workers.schedule_mail_enabled … 作業員単位の ON/OFF（既定 ON。テナントの設定が ON の時だけ効く）
--   2. cron 'schedule-notify' … 毎時 EF schedule-notify に {action:'remind'} を投げる（前日リマインド）。
--      EF 側はテナントの settings.notify_schedule_mail_enabled='true' かつ schedule_reminder_time の時刻の所しか動かない
--      ＝この cron が回っても既定（未設定=OFF）では何も送らない。共有シークレットは daily-reminder と同じ Vault。
--  テナント単位の ON/OFF は settings（notify_schedule_mail_enabled / schedule_reminder_time）で DDL 不要。
-- ============================================================
alter table public.workers add column if not exists schedule_mail_enabled boolean not null default true;
comment on column public.workers.schedule_mail_enabled is 'スケジュール管理の通知メール（予定の作成/変更/削除・前日リマインド）を受け取るか。テナント設定 notify_schedule_mail_enabled が true の時だけ効く';

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('schedule-notify');
exception when others then null;
end $$;

select cron.schedule(
  'schedule-notify',
  '0 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/schedule-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{"action":"remind"}'::jsonb
  );
  $cron$
);
