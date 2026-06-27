-- ============================================================
--  20260626030000_document_send_logs.sql
--  業者向けドキュメント送信（メール送信／URLコピー発行）の送信履歴。
--   - 見積アップ依頼・PO送信・請求依頼・変更注文・業者登録依頼 などの「いつ・誰に・何を」を残す。
--   - EF(service_role)が send/copy 成功時に1行 insert。admin は自accountの履歴を閲覧。
--  追加のみDDL（CREATE TABLE / index / POLICY）。破壊的変更なし。
--  ※ current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み。
-- ============================================================

create table if not exists public.document_send_logs (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references accounts(id) not null,
  subcontractor_id uuid references subcontractors(id),
  purpose          text not null,                 -- 'estimate_upload' / 'order_accept' / 'invoice_submit' / 'change_accept' / 'vendor_register'
  kind             text not null default 'send',  -- 'send'(メール送信) / 'copy'(URLコピー発行)
  recipients       text[] not null default '{}',  -- 送信宛先（kind='send' のとき）。メールアドレス
  subject          text,
  created_by       uuid,                           -- 操作した admin の auth.users.id（best-effort）
  created_at       timestamptz not null default now()
);
create index if not exists document_send_logs_acct_sub_idx
  on public.document_send_logs (account_id, subcontractor_id, created_at desc);

alter table public.document_send_logs enable row level security;
create policy dsl_sel on public.document_send_logs for select to authenticated
  using (account_id = (select public.current_account_id()));
-- insert は EF(service_role)のみ＝authenticated への insert ポリシーは作らない。
revoke all on public.document_send_logs from anon;
