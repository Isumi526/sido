-- ============================================================
--  subcontractor_invoices.pdf_bucket 追加（下請け請求書PDFのバケットを記録）
--
--  ★止血: 旧バケット expense-receipts は public=true で、キーを一切付けない curl でも
--   請求書PDFが落ちてくる（2026-08-13 実測・530KBのPDFが HTTP 200）。
--   2026-07-09 の v2 移行後も下請け請求書だけは書き込みが続いており（最終 7/31）、
--   出血が止まっていなかった。新規アップロード先を非公開の admin-docs へ向けるため、
--   読む側が出し分けられるようにバケットを記録する。
--
--  - 既定 'expense-receipts'（既存194件は公開バケットのまま＝後方互換 dual-read）。
--    既存行を書き換えないので、今表示できているPDFは今までどおり開ける。
--  - 追加のみDDL（非破壊）。
--  - estimates / purchase_orders / estimate_sends は 2026-06〜07 に同じ形で対応済み。
--    下請け請求書だけ取り残されていた。
-- ============================================================
alter table public.subcontractor_invoices
  add column if not exists pdf_bucket text not null default 'expense-receipts';

comment on column public.subcontractor_invoices.pdf_bucket is
  '添付請求書PDFのStorageバケット（expense-receipts=公開の既存分 / admin-docs=非公開・短TTL署名URL）。';
