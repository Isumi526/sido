-- ============================================================
--  20260711060000_site_chat_invites_rls.sql
--  site_chat_invites は authenticated ロールに grant しているため(anonは
--  revoke済み)、RLS無効のままだと他テナントの管理者が自分のJWTで直接
--  他account_idの招待(token_hash含む)を読み書きできてしまう(Gemini指摘)。
--  process_tasks/purchase_orders と同じ current_account_id() パターンでRLS化。
--  実運用のcreate/resolveはedge(site-chat-invite・service_role)経由のみで、
--  クライアントから直接この表を叩くコードは無い＝挙動影響なし。
--  追加のみDDL（ENABLE RLS / POLICY）。非破壊。
-- ============================================================

alter table public.site_chat_invites enable row level security;

create policy sci_sel on public.site_chat_invites for select to authenticated
  using (account_id = (select public.current_account_id()));
create policy sci_ins on public.site_chat_invites for insert to authenticated
  with check (account_id = (select public.current_account_id()));
create policy sci_upd on public.site_chat_invites for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));
