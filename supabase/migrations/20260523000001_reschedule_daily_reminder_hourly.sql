-- 毎時実行に変更（各アカウントの reminder_time 設定と照合して実行）
SELECT cron.unschedule('daily-reminder');

SELECT cron.schedule(
  'daily-reminder',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/daily-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
