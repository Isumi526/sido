-- ============================================================
--  20260919220000_tool_events_sync_reservations.sql
--  リソース予定B-2：道具の持出／返却（tool_events）で、その道具の予約を 使用中／終了 に自動遷移させる。
--  Notion: 【リソース予定B-2】 https://app.notion.com/p/3e00ff81c56b81228dd0dddd1315b5ad
--
--  ★なぜ: 予定管理の道具タブで「使用中」は人が入れるのではなく実績（道具②のQR持出／返却）から
--   自動で埋める（設計 2-2）。予約なしで持ち出した分は tools.status='out' から列見出しに出す（EF側）。
--
--  ・checkout / transfer → その道具の「当日を含む予約（reserved）」を in_use に。同じ人の予約を優先し、
--    無ければ誰の予約でも（先に予約した人へは EF 側で重なり通知済み）。
--  ・return → その道具の in_use を done に。
--  ★追加のみ（トリガ＋関数）。tool_events の行自体は触らない。
-- ============================================================
create or replace function public.tool_events_sync_reservations()
returns trigger
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_id uuid;
begin
  if new.kind in ('checkout', 'transfer') then
    -- 同じ人の当日予約を優先
    select id into v_id from public.resource_reservations
      where account_id = new.account_id and resource_type = 'tool' and resource_ref = new.tool_id
        and status = 'reserved' and deleted_at is null and start_date <= v_today and end_date >= v_today
        and worker_id is not distinct from new.worker_id
      order by start_date limit 1;
    if v_id is null then
      select id into v_id from public.resource_reservations
        where account_id = new.account_id and resource_type = 'tool' and resource_ref = new.tool_id
          and status = 'reserved' and deleted_at is null and start_date <= v_today and end_date >= v_today
        order by start_date limit 1;
    end if;
    if v_id is not null then
      update public.resource_reservations set status = 'in_use' where id = v_id;
    end if;
  elsif new.kind = 'return' then
    update public.resource_reservations set status = 'done'
      where account_id = new.account_id and resource_type = 'tool' and resource_ref = new.tool_id
        and status = 'in_use' and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tool_events_sync_reservations on public.tool_events;
create trigger trg_tool_events_sync_reservations
  after insert on public.tool_events
  for each row execute function public.tool_events_sync_reservations();

-- ── ロールバック手順 ──
--   drop trigger if exists trg_tool_events_sync_reservations on public.tool_events;
--   drop function if exists public.tool_events_sync_reservations();
