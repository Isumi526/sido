-- ============================================================
--  20260705010000_worker_attachments.sql
--  作業員に「履歴書（PDF/画像）」等の添付を複数登録できるように（権限ガード付き）。
--   - worker_attachments テーブル新設。
--   - 非公開バケット worker-attachments（vehicle-attachments と同方針・account_id パススコープ）。
--     直アクセス不可＝閲覧は edge(worker-attachment-url) の短TTL署名URL経由のみ。
--   - RLS はテーブル無効（既存マスタと同方針・マスタRLS化は親エピックで一括）。追加のみDDL・冪等。
-- ============================================================

create table if not exists worker_attachments (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references workers(id) on delete cascade,
  account_id  uuid references accounts(id),
  kind        text not null default 'resume',  -- 履歴書=resume（将来 document 等に拡張可）
  name        text,
  path        text not null,                    -- ストレージ内パス（先頭フォルダ=account_id）
  created_at  timestamptz not null default now()
);

create index if not exists idx_worker_attachments_worker  on worker_attachments (worker_id);
create index if not exists idx_worker_attachments_account on worker_attachments (account_id);

alter table worker_attachments disable row level security;

-- 非公開バケット（public=false）。既存があれば非公開へ揃える。
insert into storage.buckets (id, name, public)
values ('worker-attachments', 'worker-attachments', false)
on conflict (id) do update set public = false;

-- authenticated（admin / office）は自account配下（path 先頭フォルダ = account_id::text）のみ操作可
drop policy if exists wrk_att_insert on storage.objects;
create policy wrk_att_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'worker-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );

drop policy if exists wrk_att_select on storage.objects;
create policy wrk_att_select on storage.objects for select to authenticated
  using (
    bucket_id = 'worker-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );

drop policy if exists wrk_att_delete on storage.objects;
create policy wrk_att_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'worker-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );
