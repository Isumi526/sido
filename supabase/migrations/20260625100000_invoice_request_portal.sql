-- ============================================================
--  invoice_request_portal
--  ① 請求フォーム（業者入力）＋注文書照合の基盤（追加のみ・後方互換）。
--  - subcontractor_invoices.source : 請求の出所（'admin' 既定 / 'portal' = 業者がフォーム送信）
--  - purchase_orders.invoice_requested_at : 担当者が「請求依頼」を送った日時（証跡・UI表示用）
--  どちらも ADD COLUMN のみ＝既存データ・既存クエリに影響しない。
-- ============================================================

alter table public.subcontractor_invoices
  add column if not exists source text not null default 'admin';

alter table public.purchase_orders
  add column if not exists invoice_requested_at timestamptz;
