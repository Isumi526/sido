-- ============================================================
--  リマインド cron に共有シークレットを付与（第三者のURL直叩き防止）
--  - cron は Vault の secret 'reminder_trigger_secret' を x-reminder-secret ヘッダで渡す。
--  - EF 側は env REMINDER_TRIGGER_SECRET と一致を検証（_shared/reminder-auth.ts）。
--  - secret は cron 実行時に毎回 Vault から解決（schedule 時点では未作成でも可）。
--  ※ ship 時に「Vault の reminder_trigger_secret」と「EF env REMINDER_TRIGGER_SECRET」へ
--    同一値を設定して初めて enforcement が効く（それまでは後方互換で従来どおり動作）。
-- ============================================================

-- Vault が無い環境（ローカル等）でも schedule 自体は通る（subquery は実行時評価）。
do $$
begin
  -- daily-reminder（毎時・各アカウントの reminder_time と照合）
  perform cron.unschedule('daily-reminder');
exception when others then null;
end $$;

select cron.schedule(
  'daily-reminder',
  '0 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

do $$
begin
  -- shaken-reminder（週次 月曜 9:00 JST = UTC 0:00）
  perform cron.unschedule('shaken-reminder');
exception when others then null;
end $$;

select cron.schedule(
  'shaken-reminder',
  '0 0 * * 1',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/shaken-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
