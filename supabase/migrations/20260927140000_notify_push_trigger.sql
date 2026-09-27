-- ============================================================
--  20260927140000_notify_push_trigger.sql
--  アプリ内のお知らせ（schedule_notifications）が1行できたら、EF notify-push を呼んでスマホ通知も送る
--  （設計「承認や申請の処理をやることで完結＋通知の統一」A-6・2026-09-27）。
--
--  ★なぜトリガーか: お知らせは EF・管理画面・作業員アプリのあちこちで作られる（予定の作成・チャットのメンション・
--   経費の差し戻し等は画面から直接 insert）。送る箇所を1か所ずつ足すと漏れるので、行ができたら DB が呼ぶ。
--  ★呼び出しは pg_net（非同期）。お知らせの insert 自体は待たない・失敗させない（例外は握りつぶす）。
--  ★認可は cron と同じ Vault の reminder_trigger_secret。無い環境（ローカル）では何もしない＝本番の EF を呼ばない。
--  ★送る先の絞り込み（在籍中・種類のオン/オフ）と文面は EF が DB の行から読み直す（ここは id を渡すだけ）。
--
--  追加のみ。ロールバック: drop trigger schedule_notifications_push on public.schedule_notifications;
--                         drop function public.notify_push_on_notification();
-- ============================================================

create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reminder_trigger_secret' limit 1;
  if coalesce(secret, '') = '' then
    return new;
  end if;
  perform net.http_post(
    url     := 'https://nrzzesbtvswoiouhldvi.supabase.co/functions/v1/notify-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret', secret),
    body    := jsonb_build_object('id', new.id)
  );
  return new;
exception when others then
  -- 通知の作成（アプリ内のお知らせ）は止めない。スマホ通知は best-effort
  return new;
end;
$$;

revoke all on function public.notify_push_on_notification() from public, anon, authenticated;

drop trigger if exists schedule_notifications_push on public.schedule_notifications;
create trigger schedule_notifications_push
  after insert on public.schedule_notifications
  for each row execute function public.notify_push_on_notification();
