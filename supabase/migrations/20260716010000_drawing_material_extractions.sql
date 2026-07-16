-- ============================================================
--  20260716010000_drawing_material_extractions.sql
--  実施図面材料抽出(AI)の履歴保存。PDFアップロード毎の抽出結果(行データ)を保存し、
--  後から一覧で見て再度CSV書き出しできるようにする。
--  既存の他業務テーブル(operation_logs/site_shares等)と同じ「pre-RLS baseline」に合わせ、
--  account_idはクライアント側でフィルタする方式(RLSは付けない)。本番anon公開キー前提。
--  追加のみDDL（CREATE TABLE / INDEX / GRANT）。破壊的変更なし。
-- ============================================================

create table if not exists drawing_material_extractions (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  file_name   text not null,
  rows        jsonb not null default '[]'::jsonb,
  row_count   int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists drawing_material_extractions_account_idx
  on drawing_material_extractions(account_id, created_at desc);

grant select, insert on drawing_material_extractions to anon, authenticated, service_role;
