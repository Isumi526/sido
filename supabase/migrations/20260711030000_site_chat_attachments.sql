-- ============================================================
--  20260711030000_site_chat_attachments.sql
--  現場ごとのチャット②: ファイル共有。site_chat_messages に添付情報を追加し、
--  非公開バケット site-chat-attachments を新設する。
--    - アップロードは edge(site-chat-attachment-upload・service_role)経由のみ
--      （expense-receipt-upload と同型：LINE ID token / Supabase JWT を検証し、
--      アップロード直後に長期署名URLを発行してメッセージ行へ直接格納する）。
--    - 直アクセス不可（非公開バケット・storage.objectsにanon/authenticatedのポリシーを
--      作らない＝expense-receipts-v2と同方針。書込はservice_roleのみ）。
--    - 追加のみDDL（ALTER TABLE / bucket作成）。非破壊。
-- ============================================================

alter table public.site_chat_messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text,
  add column if not exists attachment_kind text;  -- 'image' | 'file'

-- 非公開バケット（public=false）。
insert into storage.buckets (id, name, public)
values ('site-chat-attachments', 'site-chat-attachments', false)
on conflict (id) do update set public = false;

comment on column public.site_chat_messages.attachment_url is
  'edge(site-chat-attachment-upload)がアップロード直後に発行する長期署名URL（expense-receipts-v2方式）。直アクセス不可のバケットのため、URL自体がアクセス鍵。';
