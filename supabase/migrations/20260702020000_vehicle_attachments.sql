-- ============================================================
--  20260702020000_vehicle_attachments.sql
--  車両に「写真＋各写真の名称」を複数登録できるように（#8）。
--   - vehicle_attachments テーブル新設（1車両に複数の写真・各写真に名称）。
--   - 非公開バケット vehicle-attachments を新設（site-attachments と同方針・account_id パススコープ）。
--     直アクセス不可＝閲覧は edge(vehicle-attachment-url) の短TTL署名URL経由のみ。
--   - #9(車両画像からナンバーAI解析)がこの写真を読む土台にもなる。
--   - RLS は既存マスタ（vehicles 等）と同じく無効のまま（マスタRLS化は別チケットで一括）。
--   追加のみDDL（CREATE TABLE / bucket upsert / storage policy）。破壊的変更なし・冪等。
-- ============================================================

-- ── vehicle_attachments（1車両に複数写真・各写真に名称）───────────
create table if not exists vehicle_attachments (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  account_id  uuid references accounts(id),
  kind        text not null default 'photo',   -- 現状 photo のみ（将来 document 等に拡張可）
  name        text,                             -- 各写真の名称（任意）
  path        text not null,                    -- ストレージ内パス（先頭フォルダ=account_id）
  created_at  timestamptz not null default now()
);

create index if not exists idx_vehicle_attachments_vehicle on vehicle_attachments (vehicle_id);
create index if not exists idx_vehicle_attachments_account on vehicle_attachments (account_id);

alter table vehicle_attachments disable row level security;

-- ── 非公開バケット（public=false）。既存があれば非公開へ揃える。────
insert into storage.buckets (id, name, public)
values ('vehicle-attachments', 'vehicle-attachments', false)
on conflict (id) do update set public = false;

-- authenticated（admin / email-pw作業員）は自account配下（path 先頭フォルダ = account_id::text）のみ操作可
drop policy if exists veh_att_insert on storage.objects;
create policy veh_att_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vehicle-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );

drop policy if exists veh_att_select on storage.objects;
create policy veh_att_select on storage.objects for select to authenticated
  using (
    bucket_id = 'vehicle-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );

drop policy if exists veh_att_delete on storage.objects;
create policy veh_att_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'vehicle-attachments'
    and (storage.foldername(name))[1] = (select public.current_account_id())::text
  );
