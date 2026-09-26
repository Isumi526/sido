-- ============================================================
--  20260924120000_overtime_reminder_cron.sql
--  未決裁の残業申請を承認者へまとめてリマインドする overtime-reminder EF を、1日2回 pg_cron から呼ぶ（A-2・2026-09-24）。
--  ★追加のみ（cron ジョブの登録）。
--
--  時刻（JST）:
--   16:05 … 当日の申請締切(16:00)の直後。その日の申請が出揃ったところで1通
--   17:30 … 作業員が日報を出し始める時間帯。ここまでに決裁されていれば、日報の時点で残業が確定する
--  pg_cron は UTC で動くので 07:05 / 08:30 で登録する。
--
--  ★なぜ要るか（2026-09-23 お客様報告・本番実測）:
--   申請時の通知はメール1通きり（notified_at で1回限り・15分より古い申請は通知対象外）で、
--   締切前申請の36%が翌日以降の承認だった。初回通知のべき等性はそのまま残し、再通知は別の軸
--   （reminder_logs の kind='overtime_pending_<slot>'・会社×日×時間帯で1回）で持つ。
--
--  ★テナントの settings.notify_approval_request_enabled='false' の所には送らない（承認依頼メールと同じ設定）。
--  ★共有シークレットは他のリマインドと同じ Vault の reminder_trigger_secret。
-- ============================================================
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('overtime-reminder-1605');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('overtime-reminder-1730');
exception when others then null;
end $$;

select cron.schedule(
  'overtime-reminder-1605',
  '5 7 * * *',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/overtime-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{"slot":"after_deadline"}'::jsonb
  );
  $cron$
);

select cron.schedule(
  'overtime-reminder-1730',
  '30 8 * * *',
  $cron$
  select net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/overtime-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'reminder_trigger_secret'), '')
    ),
    body    := '{"slot":"evening"}'::jsonb
  );
  $cron$
);
