-- ============================================================
--  20260613000000_create_purchase_orders.sql
--  注文書（purchase_orders）— 見積→注文→請求エピックの「注文書発行」(#次)
--   - 見積書(estimates)を正本に、現場ごと・注文書番号付与で注文書を発行
--   - 見積:注文 = 1:1（見積書なしに発行不可／active な注文は見積1件に1つ）
--   - 発行時点の現場・受注者・支払条件をスナップショット保持（注文書は正本のため）
--   - PDF は expense-receipts バケット（purchase-orders/<account>/<id>.pdf）に保存
--   - 発行で受注者担当者へメール（承諾用トークンURL）。トークンは document_access_tokens
--  追加のみDDL（CREATE TABLE / CREATE INDEX）。破壊的変更なし。
-- ============================================================
create table if not exists purchase_orders (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid references accounts(id) not null,
  estimate_id              uuid references estimates(id) not null,        -- 見積:注文=1:1（縛り）
  subcontractor_id         uuid references subcontractors(id),            -- 受注者（業者）
  subcontractor_contact_id uuid references subcontractor_contacts(id),    -- 受注者担当者（選択）
  site_id                  uuid references sites(id),                     -- 現場
  order_number             text not null,                                 -- 注文書番号（採番 PO-YYYY-0001）
  order_date               date,                                          -- 注文書発行日
  total_amount             integer,                                       -- 合計金額（見積から集約）
  -- 現場スナップショット
  site_name                text,
  construction_location    text,                                          -- 工事場所
  period_start             date,                                          -- 工期 開始
  period_end               date,                                          -- 工期 完了
  manager_name             text,                                          -- 担当者（Sido側）
  -- 受注者スナップショット
  vendor_name              text,
  vendor_contact_name      text,
  vendor_phone             text,
  -- 支払条件・特記事項（settings のデフォルトから初期化・編集可）
  payment_terms            text,                                          -- 支払条件
  bank_info                text,                                          -- 振込先
  inspection_terms         text,                                          -- 検収条件
  change_rule              text,                                          -- 追加変更ルール
  special_notes            text,                                          -- 特記事項（自由）
  pdf_path                 text,                                          -- 生成した注文書PDFパス
  status                   text not null default 'issued',                -- issued / accepted / changed 等
  issued_at                timestamptz,                                   -- 発行日時
  email_sent_at            timestamptz,                                   -- 受注者への通知メール送信日時
  email_to                 text,                                          -- 送信先メール（記録）
  note                     text,
  is_deleted               boolean default false,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

create index if not exists po_account_idx          on purchase_orders (account_id);
create index if not exists po_estimate_idx         on purchase_orders (estimate_id);
create index if not exists po_subcontractor_idx    on purchase_orders (subcontractor_id);
create index if not exists po_site_idx             on purchase_orders (site_id);

-- 見積:注文=1:1（active な注文は1見積につき1つ）。ソフト削除分は対象外。
create unique index if not exists po_estimate_active_unique
  on purchase_orders (estimate_id) where is_deleted = false;

-- 既存マスタ群と同様、アプリ/Edge側でテナント分離（anonキー運用）するため RLS は無効
alter table purchase_orders disable row level security;
