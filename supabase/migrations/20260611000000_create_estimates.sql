-- ============================================================
--  20260611000000_create_estimates.sql
--  見積書（estimates）— 見積→注文→請求エピックの土台（#4 AC1/AC3）
--   - 業者から受け取った見積書PDFをアップロードし、業者・現場に紐付けて保存
--   - 合計金額・工事内容は担当者が目視入力（AIによる自動抽出=AC2は別途・設計承認後）
--   - 見積書番号を採番（注文書発行時に参照される土台）
--  追加のみDDL（CREATE TABLE / CREATE INDEX）。破壊的変更なし。
--  PDF保存は既存バケット expense-receipts を流用（estimates/<account>/<id>.pdf）。
-- ============================================================
create table if not exists estimates (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid references accounts(id) not null,
  subcontractor_id     uuid references subcontractors(id),   -- 受注者（下請け業者）
  site_id              uuid references sites(id),            -- 現場
  estimate_number      text not null,                         -- 見積書番号（採番）
  estimate_date        date,                                  -- 見積書発行日
  total_amount         integer,                               -- 合計金額（目視入力）
  construction_details text,                                  -- 工事内容（目視入力）
  pdf_path             text,                                  -- expense-receipts 上のPDFパス
  note                 text,
  is_deleted           boolean default false,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create index if not exists est_account_idx       on estimates (account_id);
create index if not exists est_subcontractor_idx on estimates (subcontractor_id);
create index if not exists est_site_idx          on estimates (site_id);

-- 既存マスタ群と同様、アプリ側でテナント分離（anonキー運用）するため RLS は無効
alter table estimates disable row level security;
