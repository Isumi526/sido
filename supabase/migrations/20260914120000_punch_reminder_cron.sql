-- ============================================================
--  20260914120000_punch_reminder_cron.sql
--  スケジュールの現場の開始・終了時刻に「打刻を」の通知を出す punch-reminder EF を
--  pg_cron から 5 分おきに呼ぶ。
--
--  ★追加のみ（cron ジョブの登録）。EF 側はテナントの settings.notify_punch_reminder_enabled が
--   'true' の所しか動かないので、この cron が回っても既定（未設定=OFF）では何も送らない。
--  ★共有シークレットは daily-reminder と同じ Vault の reminder_trigger_secret を使う。
-- ============================================================
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('punch-reminder');
exception when others then null;
end $$;

select cron.schedule(
  'punch-reminder',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/punch-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
