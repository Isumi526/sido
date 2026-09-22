-- ─────────────────────────────────────────────────────────────────────
--  20260922100000_subcontractor_invoices_tax_override.sql
--  協力業者請求の消費税を「請求書の記載どおり」に手で上書きできるようにする（尾崎さん要望 2026-09-22）。
--  画面は明細×税率を合算して1回四捨五入するため、切り捨て等で計算された請求書と ¥1〜数円ズレる。
--  null ＝ 従来どおり計算値（invoiceTax.ts）。値があればそれを消費税として使い、税込＝税抜計＋この値。
--  税抜の原価（月次・現場別集計の netAmountOf）は行単位で変わらない＝集計に影響しない。
--  追加のみDDL・ロールバック: alter table subcontractor_invoices drop column tax_override;
-- ─────────────────────────────────────────────────────────────────────
alter table public.subcontractor_invoices
  add column if not exists tax_override numeric;
comment on column public.subcontractor_invoices.tax_override is
  '消費税の手入力上書き（請求書の記載どおりに合わせる用）。NULL=明細から計算（invoiceTax.ts）。税込=税抜計+この値';
