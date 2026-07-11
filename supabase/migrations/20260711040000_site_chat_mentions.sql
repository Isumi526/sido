-- ============================================================
--  20260711040000_site_chat_mentions.sql
--  現場ごとのチャット③: メンション+通知。
--   - site_chat_messages に mentioned_worker_ids(uuid[]) を追加（@メンション記録）。
--   - site_chat_mentions: メンションされた作業員あてのアプリ内通知（schedule_notificationsと同型）。
--     未読件数バッジ用。RLSは既存マスタ/schedule_notificationsと同じく無効。
--   - 追加のみDDL（ALTER TABLE / CREATE TABLE / INDEX）。非破壊。
-- ============================================================

alter table public.site_chat_messages
  add column if not exists mentioned_worker_ids uuid[] not null default '{}';

create table if not exists public.site_chat_mentions (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  worker_id   uuid not null references workers(id) on delete cascade,  -- 受信者（メンションされた作業員）
  message_id  uuid references site_chat_messages(id) on delete cascade,
  site_id     uuid references sites(id),
  created_at  timestamptz not null default now(),
  read_at     timestamptz  -- null=未読
);

create index if not exists site_chat_mentions_worker_unread_idx
  on public.site_chat_mentions (worker_id, read_at);
create index if not exists site_chat_mentions_account_idx
  on public.site_chat_mentions (account_id);

alter table public.site_chat_mentions disable row level security;
grant select, insert, update on public.site_chat_mentions to anon, authenticated, service_role;
