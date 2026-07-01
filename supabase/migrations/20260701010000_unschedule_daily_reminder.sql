-- ============================================================
--  20260701010000_unschedule_daily_reminder.sql
--  脱LINE: 日報未送信リマインド(daily-reminder)の pg_cron 自動実行を停止する。
--    - 8:00(JST)のLINEリマインドを cron ごと止める（settings.reminder_enabled だけでなく実行自体を停止）。
--    - shaken-reminder（車検・毎週月曜）など他のcronは触らない。
--    - 再開する場合は 20260625030000_reminder_cron_secret.sql の cron.schedule を再適用する。
--    - 冪等（存在する時だけ unschedule）。
-- ============================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-reminder') then
    perform cron.unschedule('daily-reminder');
  end if;
end $$;
