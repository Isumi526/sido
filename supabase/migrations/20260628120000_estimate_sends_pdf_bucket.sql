-- ============================================================
--  estimate_sends.pdf_bucket 追加（見積送信履歴の添付PDFバケットを記録）
--  - 注文書/見積PDFの署名URL移行(stage-2)に伴い、送信時点のバケットを履歴に残す。
--  - 既定 'expense-receipts'（既存履歴は公開バケットのまま＝後方互換）。
--  - 追加のみDDL（非破壊）。
-- ============================================================
alter table public.estimate_sends
  add column if not exists pdf_bucket text not null default 'expense-receipts';

comment on column public.estimate_sends.pdf_bucket is
  '送信時の添付見積PDFのStorageバケット（expense-receipts=公開 / admin-docs=非公開署名URL）。';
