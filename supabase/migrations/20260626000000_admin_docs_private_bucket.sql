-- ============================================================
--  20260626000000_admin_docs_private_bucket.sql
--  ⑤(段階A) 管理者発行物（注文書PDF・見積書PDF）を「公開URL」から「非公開＋署名URL」へ。
--   - 専用 private バケット admin-docs を新設（expense-receipts は領収書が公開URLを daily_reports に
--     永続保存しているため不可侵。受領領収書は当面公開のまま＝段階A）。
--   - 既存PDFは移動しない。purchase_orders / estimates に pdf_bucket 列を追加し、
--     **新規アップロードのみ** admin-docs(非公開) に置く。既存行は既定 'expense-receipts'(公開)のまま
--     ＝後方互換 dual-read（読む側が bucket を見て 署名URL or 公開URL を出し分け）。
--   - storage.objects RLS: authenticated は自account配下(path 先頭=account_id)のみ操作可。
--     anon 不可。service_role(anonポータルEF) は RLS バイパスで署名URL発行。
--  追加のみDDL（bucket upsert / policy / ADD COLUMN）。破壊的変更なし・冪等。
-- ============================================================

insert into storage.buckets (id, name, public)
values ('admin-docs', 'admin-docs', false)
on conflict (id) do update set public = false;

drop policy if exists admin_docs_insert on storage.objects;
create policy admin_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'admin-docs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists admin_docs_select on storage.objects;
create policy admin_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'admin-docs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists admin_docs_update on storage.objects;
create policy admin_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'admin-docs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists admin_docs_delete on storage.objects;
create policy admin_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'admin-docs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

-- どのバケットに置いたかを行に記録（既定=既存の公開バケット）。dual-read の判定に使う。
alter table public.purchase_orders add column if not exists pdf_bucket text not null default 'expense-receipts';
alter table public.estimates      add column if not exists pdf_bucket text not null default 'expense-receipts';
