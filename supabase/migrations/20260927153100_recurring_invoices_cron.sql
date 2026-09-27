-- ============================================================
--  20260927153100_recurring_invoices_cron.sql
--  協力会社請求の毎月定額を登録する recurring-invoices EF を、毎日 JST 06:10 に pg_cron から呼ぶ（2026-09-27）。追加のみ。
--  毎日呼ぶが、作るのは「登録日を過ぎていて今月分がまだ」のひな形だけ（shared/recurring-invoice.ts dueToday）。
--  cron が止まった日があっても、翌日の実行で今月分が作られる。
--  pg_cron は UTC で動くので 21:10（前日）で登録する。共有シークレットは他のリマインドと同じ Vault の reminder_trigger_secret。
-- ============================================================
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('recurring-invoices');
exception when others then null;
end $$;

select cron.schedule(
  'recurring-invoices',
  '10 21 * * *',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/recurring-invoices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
