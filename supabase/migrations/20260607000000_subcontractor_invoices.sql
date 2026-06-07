-- ============================================================
--  下請け業者の請求情報（ヘッダ＋明細）
--  - 管理者が請求書を転記、将来は業者向けフォームから直接入力に流用
--  - 明細(items)は site_id/account_id を持ち現場別集計(site-reports)に反映
--  - 追加のみ・後方互換。RLS 無効（既存方針）
-- ============================================================

-- 請求ヘッダ
create table if not exists subcontractor_invoices (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references accounts(id) not null,
  subcontractor_id uuid references subcontractors(id),    -- 下請け業者マスタ（区分はこちらが持つ）
  vendor_name      text not null,                         -- 業者名（表示・流用用に保持）
  title            text,                                  -- 件名
  invoice_no       text,                                  -- 請求番号
  registration_number text,                              -- インボイス登録番号（T+13桁）
  invoice_date     date,                                  -- 請求日
  due_date         date,                                  -- 支払い期限
  transfer_date    date,                                  -- 支払日（振込日）
  paid             boolean not null default false,        -- 支払い済み
  total_amount     integer,                               -- 請求金額（請求書記載値・税込）
  pdf_path         text,                                  -- expense-receipts 上のPDF
  note             text,                                  -- メモ
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 請求明細
create table if not exists subcontractor_invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid references subcontractor_invoices(id) on delete cascade not null,
  account_id  uuid references accounts(id) not null,      -- 集計クエリ用に非正規化
  item_date   date,                                       -- 日付
  site_id     uuid references sites(id),                  -- 現場（プルダウン）
  site_name   text,                                       -- 表示・流用用に名称も保持
  description text,                                       -- 工事内容/品番/品名
  quantity    numeric,                                    -- 数量
  unit        text,                                       -- 単位
  unit_price  integer,                                    -- 単価
  amount      integer,                                    -- 金額(税抜)=数量×単価
  tax_rate    numeric not null default 10,                -- 税率%（既定10）
  note        text,
  sort_order  int default 0
);

create index if not exists si_account_idx           on subcontractor_invoices(account_id);
create index if not exists sii_invoice_idx          on subcontractor_invoice_items(invoice_id);
create index if not exists sii_account_site_date_idx on subcontractor_invoice_items(account_id, site_id, item_date);

alter table subcontractor_invoices      disable row level security;
alter table subcontractor_invoice_items disable row level security;
