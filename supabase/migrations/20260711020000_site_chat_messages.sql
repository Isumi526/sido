-- ============================================================
--  20260711020000_site_chat_messages.sql
--  現場ごとのチャット機能（①MVP: 認証済みユーザー間のテキストチャット）。
--  現場に紐づく作業員/管理者同士がテキストメッセージをやり取りする。
--  ファイル共有・メンション・非ユーザー招待・通知は後続フェーズ（エピック「現場管理」内で追跡）。
--    - 既存 LIFF 露出テーブル群（overtime_requests/report_edit_grants 等）と同じ
--      anon運用（RLS無効・account_idで論理分離）。本番RLS化は親エピックで一括。
--    - sender_worker_id は作業員送信のみ設定（admin/office送信はnull）。
--      sender_name は送信時点の表示名スナップショット（approved_by等と同じ非正規化パターン）。
--    - realtime配信（report_edit_grants/overtime_requestsと同じ手法・非破壊）。
--    - 追加のみDDL（CREATE TABLE / INDEX / GRANT）。非破壊。
-- ============================================================

create table if not exists public.site_chat_messages (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(id) not null,
  site_id           uuid references sites(id) not null,
  sender_worker_id  uuid,                    -- workers.id（作業員送信時のみ）。admin送信はnull
  sender_is_admin   boolean not null default false,
  sender_name       text not null,           -- 送信時点の表示名スナップショット
  body              text not null,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists site_chat_messages_site_idx
  on public.site_chat_messages (account_id, site_id, created_at);

-- 既存 LIFF 露出テーブルに合わせ anon 運用（RLS無効）。本番RLS化は親エピックで一括。
alter table public.site_chat_messages disable row level security;
grant select, insert, update on public.site_chat_messages to anon, authenticated, service_role;

comment on table public.site_chat_messages is
  '現場ごとのチャット(MVP・テキストのみ)。account_id/site_idで論理分離。ファイル/メンション/非ユーザー招待は後続フェーズ。';

-- realtime配信（LIFF/adminの即時反映用・websocket不安定時はクライアント側でポーリング併用）
alter table public.site_chat_messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_chat_messages'
  ) then
    alter publication supabase_realtime add table public.site_chat_messages;
  end if;
end $$;
