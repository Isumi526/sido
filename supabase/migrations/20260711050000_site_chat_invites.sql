-- ============================================================
--  20260711050000_site_chat_invites.sql
--  現場ごとのチャット④(前半): 非ユーザー招待リンク。
--  document_access_tokens(下請けポータル)と同型：平文トークンは保存せずSHA-256ハッシュのみ保持。
--  非ユーザー(LINE友だち未登録者)は edge(site-chat-invite・resolve)でトークンを検証し、
--  site_id/account_idを得た上でLIFF側の既存 site_chat_messages anon運用にそのまま乗る
--  （招待リンクの知得＝アクセス鍵。他のLIFF露出anon表と同水準の信頼モデル）。
--  追加のみDDL（CREATE TABLE / INDEX）。非破壊。
-- ============================================================

create table if not exists public.site_chat_invites (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  site_id     uuid references sites(id) not null,
  token_hash  text not null unique,      -- SHA-256(token)の16進。平文は保存しない
  created_by  uuid references workers(id),
  revoked_at  timestamptz,               -- 手動失効（null=有効）
  created_at  timestamptz not null default now()
);

create index if not exists site_chat_invites_token_hash_idx on public.site_chat_invites (token_hash);
create index if not exists site_chat_invites_site_idx       on public.site_chat_invites (site_id);

-- トークン発行/検証は edge(site-chat-invite・service_role)経由のみ。テーブル自体はanon非公開。
alter table public.site_chat_invites disable row level security;
revoke all on public.site_chat_invites from anon;
grant select, insert, update on public.site_chat_invites to authenticated, service_role;
