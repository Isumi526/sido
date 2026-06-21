CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 毎週月曜 9時 JST（UTC 月曜 0:00）に shaken-reminder（車検期日リマインド）を実行
SELECT cron.schedule(
  'shaken-reminder',
  '0 0 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/shaken-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
