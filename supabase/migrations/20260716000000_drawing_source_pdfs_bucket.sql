-- ============================================================
--  20260716000000_drawing_source_pdfs_bucket.sql
--  実施図面材料抽出（drawing-materials.vue）のアップロード元PDFを保存する非公開バケット。
--   - アップロード時点でSupabase Storageに保存し、ページ単位の解析失敗時に元ファイルの
--     再選択なしで再試行できるようにする（admin-docs と同型のaccount_idスコープRLS）。
--  追加のみDDL（bucket upsert / policy）。破壊的変更なし・冪等。
-- ============================================================

insert into storage.buckets (id, name, public)
values ('drawing-source-pdfs', 'drawing-source-pdfs', false)
on conflict (id) do update set public = false;

drop policy if exists drawing_source_pdfs_insert on storage.objects;
create policy drawing_source_pdfs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'drawing-source-pdfs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists drawing_source_pdfs_select on storage.objects;
create policy drawing_source_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'drawing-source-pdfs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists drawing_source_pdfs_update on storage.objects;
create policy drawing_source_pdfs_update on storage.objects for update to authenticated
  using (bucket_id = 'drawing-source-pdfs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists drawing_source_pdfs_delete on storage.objects;
create policy drawing_source_pdfs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'drawing-source-pdfs' and (storage.foldername(name))[1] = (select public.current_account_id())::text);
