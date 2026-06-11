-- ============================================================
--  20260610000000_subcontractor_master_contacts.sql
--  下請け業者マスタ拡張（見積→注文→請求エピックの土台 / 安全な部分）
--   - subcontractors に 住所・振込口座 列を追加（追加のみ・後方互換）
--   - 業者担当者マスタ subcontractor_contacts（1業者に複数担当者）を新設
--  ※ トークン認証基盤（#2 AC3）は別途・設計承認後に追加するためここには含めない。
--  追加のみDDL（ADD COLUMN / CREATE TABLE / CREATE INDEX）。破壊的変更なし。
-- ============================================================

-- 業者：住所・振込口座
alter table subcontractors
  add column if not exists address               text,
  add column if not exists bank_name             text,
  add column if not exists bank_branch           text,
  add column if not exists bank_account_type     text,   -- 普通 / 当座 等（自由入力）
  add column if not exists bank_account_number   text,
  add column if not exists bank_account_holder   text;   -- 口座名義

-- 業者担当者（1業者に複数。注文書/請求の宛先選択に使う）
create table if not exists subcontractor_contacts (
  id               uuid primary key default gen_random_uuid(),
  subcontractor_id uuid references subcontractors(id) on delete cascade,
  account_id       uuid references accounts(id),
  name             text not null,
  email            text,
  phone            text,
  sort_order       int default 0,
  is_deleted       boolean default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists idx_subcontractor_contacts_sub
  on subcontractor_contacts (subcontractor_id);
create index if not exists idx_subcontractor_contacts_account
  on subcontractor_contacts (account_id);
