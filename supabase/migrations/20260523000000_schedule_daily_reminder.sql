CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 毎朝8時 JST（UTC 23:00）に daily-reminder を実行
SELECT cron.schedule(
  'daily-reminder',
  '0 23 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/daily-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
