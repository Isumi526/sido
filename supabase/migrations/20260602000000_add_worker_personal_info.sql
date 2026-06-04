-- ============================================================
--  supabase/migrations/20260602000000
--  作業員の個人情報（生年月日・住所・緊急連絡先）を追加
--
--  入社日(hire_date)は 20260521000001_add_paid_leave.sql で追加済み。
--  全カラムNULL許容（既存データ保護）。workers は RLS 無効のまま。
-- ============================================================

alter table workers
  add column if not exists birth_date        date,
  add column if not exists address           text,
  add column if not exists emergency_contact text;
