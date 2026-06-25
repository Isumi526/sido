-- ============================================================
--  下請け請求(subcontractor_invoices)に注文書(purchase_orders)リンクを追加
--  出来高払い: 1注文書に複数回の請求 → 注文書金額に対する残額管理のため。
--  追加のみ（ADD COLUMN nullable・FK）。既存請求(PO未紐付け)は後方互換でそのまま。
-- ============================================================
alter table subcontractor_invoices
  add column if not exists purchase_order_id uuid references purchase_orders(id);
create index if not exists sub_invoices_po_idx
  on subcontractor_invoices(purchase_order_id);
