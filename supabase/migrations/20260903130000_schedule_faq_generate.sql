-- ============================================================
--  週1（月曜9:00 JST）で faq-generate を実行する。
--  認可は既存のリマインドcronと同じ共有シークレット方式を流用
--  （Vault の reminder_trigger_secret を x-reminder-secret ヘッダで渡す。
--   EF側は _shared/reminder-auth.ts の authorizeReminderTrigger で検証）。
-- ============================================================

do $$
begin
  perform cron.unschedule('faq-generate-weekly');
exception when others then null;
end $$;

select cron.schedule(
  'faq-generate-weekly',
  '0 0 * * 1',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/faq-generate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
