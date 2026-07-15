-- ============================================================
--  site_chat_last_read
--  現場チャット一覧ページ(admin/LIFF)の未読メッセージバッジ用。
--  site_chat_messages には既読管理カラムが無く、既存の未読管理は
--  site_chat_mentions(@メンション宛のみ・LIFF workerのみ)に限られるため、
--  「一覧上の各現場チャットの未読メッセージ件数」を出すために
--  actor(LIFF workerId または admin authユーザーid)ごとの最終既読時刻を持つ。
--  RLS方針は既存チャット系テーブル(site_chat_messages等)と同型
--  (RLS無効・anon/authenticated/service_roleへgrant・account_id/site_idはクライアント側で絞る)。
-- ============================================================
create table if not exists public.site_chat_last_read (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references accounts(id) not null,
  site_id       uuid references sites(id) not null,
  actor_key     text not null,   -- LIFF: workers.id(text) / admin: auth.users.id(text)
  last_read_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists site_chat_last_read_actor_site_uniq
  on public.site_chat_last_read (account_id, site_id, actor_key);
create index if not exists site_chat_last_read_actor_idx
  on public.site_chat_last_read (account_id, actor_key);

alter table public.site_chat_last_read disable row level security;
grant select, insert, update on public.site_chat_last_read to anon, authenticated, service_role;
