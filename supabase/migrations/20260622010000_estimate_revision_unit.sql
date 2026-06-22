-- ============================================================
--  supabase/migrations/20260622010000_estimate_revision_unit
--  価格表OCR(E4)が読んだ「単位」を差分→承認で材料へ引き継ぐため、
--  estimate_price_revisions に unit 列を追加（追加のみ・非破壊）。
-- ============================================================
alter table estimate_price_revisions add column if not exists unit text;
