-- ============================================================
--  20260615010000_site_attachments_private_bucket.sql
--  現場詳細の添付を「公開URL」から「非公開バケット＋署名URL」へ。
--   - 専用の private バケット site-attachments を新設（expense-receipts は共有のため不可侵）。
--   - 直アクセス（getPublicUrl）を不可能にし、閲覧は edge(site-attachment-url) の
--     短TTL署名URL経由のみ＝独立レビュー(anon-access-token)の公開URL指摘を解消。
--   - storage.objects RLS: authenticated(admin/email-pw作業員) は自account配下のみ
--     アップロード/削除/参照可（path 先頭フォルダ = account_id）。
--     anon はポリシー無し＝不可。service_role(edge) は RLS バイパスで署名URL発行。
--  追加のみDDL（bucket upsert / policy）。破壊的変更なし・冪等。
-- ============================================================

-- 非公開バケット（public=false）。既存があれば非公開へ揃える。
insert into storage.buckets (id, name, public)
values ('site-attachments', 'site-attachments', false)
on conflict (id) do update set public = false;

-- authenticated は自account配下（path 先頭フォルダ = account_id::text）のみ操作可
drop policy if exists site_att_insert on storage.objects;
create policy site_att_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );

drop policy if exists site_att_select on storage.objects;
create policy site_att_select on storage.objects for select to authenticated
  using (
    bucket_id = 'site-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );

drop policy if exists site_att_delete on storage.objects;
create policy site_att_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'site-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );
