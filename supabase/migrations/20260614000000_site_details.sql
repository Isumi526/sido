-- ============================================================
--  20260614000000_site_details.sql
--  現場詳細（緊急）：作業員・管理者が現場情報を閲覧/編集できるようにする土台
--   - sites に詳細列（場所・工事種類・工事内容・メモ）を追加
--   - 写真・書類（複数）は site_attachments で保持（storage は expense-receipts 流用）
--  追加のみDDL（ADD COLUMN / CREATE TABLE / CREATE INDEX）。破壊的変更なし。
-- ============================================================
alter table sites
  add column if not exists location              text,   -- 場所/住所
  add column if not exists construction_type     text,   -- 工事種類
  add column if not exists construction_details  text,   -- 工事内容
  add column if not exists memo                  text;   -- メモ

create table if not exists site_attachments (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  site_id     uuid references sites(id) not null,
  kind        text not null default 'photo',   -- 'photo' | 'document'
  path        text not null,                    -- expense-receipts 上のパス
  name        text,                             -- 表示名（元ファイル名）
  created_at  timestamptz default now()
);

create index if not exists site_att_site_idx    on site_attachments (site_id);
create index if not exists site_att_account_idx on site_attachments (account_id);

-- 既存マスタ群と同様、アプリ/Edge側でテナント分離（anonキー運用）するため RLS は無効
alter table site_attachments disable row level security;
