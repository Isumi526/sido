-- ============================================================
--  20260716010000_drawing_material_extractions.sql
--  実施図面材料抽出(AI)の履歴保存。PDFアップロード毎の抽出結果(行データ)を保存し、
--  後から一覧で見て再度CSV書き出しできるようにする。
--  ★standalone-safe: 新規テーブルのため生成時点でaccount_idスコープRLSを有効化する
--    （.kody/accepted.yml のratchet方針＝新規のRLS無効×anon表は増やさない。
--    purchase_order_changes/admin-docs と同型）。書込・読取ともadmin(authenticated)のみ。
--  追加のみDDL（CREATE TABLE / INDEX / POLICY / enable RLS / revoke）。破壊的変更なし。
-- ============================================================

create table if not exists drawing_material_extractions (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  file_name   text not null,
  rows        jsonb not null default '[]'::jsonb,
  row_count   int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists drawing_material_extractions_account_idx
  on drawing_material_extractions(account_id, created_at desc);

alter table drawing_material_extractions enable row level security;

drop policy if exists dme_sel on drawing_material_extractions;
create policy dme_sel on drawing_material_extractions for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists dme_ins on drawing_material_extractions;
create policy dme_ins on drawing_material_extractions for insert to authenticated
  with check (account_id = (select public.current_account_id()));

revoke all on drawing_material_extractions from anon;
