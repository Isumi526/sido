-- ============================================================
--  20260625110000_purchase_order_changes.sql
--  ② 変更注文書（増減額）＋業者の再承諾フロー
--   - 発行済注文書に対する金額変更（増額/減額）を1行=1変更注文書として記録（変更履歴）。
--   - 業者はトークンURL(/p/<token>, purpose='change_accept')で内容確認→署名→再承諾。
--     再承諾の証跡（日時/IP/UA/署名者/署名画像/PDFハッシュ）を本行にインライン保存
--     （1注文書に複数回の変更があり得るため、承諾は purchase_order_acceptances とは別管理）。
--   - 変更注文書が承諾されたら purchase_orders.total_amount を new_amount に更新
--     ＝最新の承諾済金額が請求照合（①の残額計算）の基準になる（AC3）。
--   - 書込は admin（発行）と subcontractor-portal Edge（再承諾・service_role）のみ。
--  ★standalone-safe: 生成時点で account スコープ RLS を有効化（purchase_orders と同方針）。
--  追加のみDDL（CREATE TABLE / INDEX / POLICY / enable RLS / revoke）。破壊的変更なし。
--  ※ current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み。
-- ============================================================

create table if not exists purchase_order_changes (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(id) not null,
  purchase_order_id uuid references purchase_orders(id) not null,
  subcontractor_id  uuid references subcontractors(id),
  seq               int  not null default 1,              -- 何回目の変更か（1始まり）
  old_amount        numeric,                              -- 変更前金額（発行時点のスナップショット）
  new_amount        numeric not null,                     -- 変更後金額
  reason            text,                                 -- 変更理由
  status            text not null default 'issued',       -- 'issued'（発行・再承諾待ち） / 'accepted'（再承諾済）
  -- 再承諾証跡（インライン）
  accepted_at       timestamptz,
  accepted_ip       text,
  user_agent        text,
  signer_name       text,
  signature_path    text,
  pdf_hash          text,
  -- メール送信記録
  email_sent_at     timestamptz,
  email_to          text,
  created_by        uuid,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists poc_account_idx on purchase_order_changes (account_id);
create index if not exists poc_order_idx   on purchase_order_changes (purchase_order_id);

-- 1注文書内で seq は一意（変更履歴の順序を一意に保つ）
create unique index if not exists poc_order_seq_unique
  on purchase_order_changes (purchase_order_id, seq);

-- ★生成時点で RLS 有効化（standalone-safe）
alter table purchase_order_changes enable row level security;

-- authenticated（admin）は自 account の変更注文書を read/insert/update（発行・履歴確認）。
-- 再承諾の書込は service_role（業者はJWTを持たない）。
create policy poc_sel on purchase_order_changes for select to authenticated
  using (account_id = (select public.current_account_id()));
create policy poc_ins on purchase_order_changes for insert to authenticated
  with check (account_id = (select public.current_account_id()));
create policy poc_upd on purchase_order_changes for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));

-- anon は一切触らない（再承諾書込は service_role 経由）→ 直接権限も剥奪。
revoke all on purchase_order_changes from anon;
