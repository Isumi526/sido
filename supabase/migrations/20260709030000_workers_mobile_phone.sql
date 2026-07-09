-- ============================================================
--  20260709030000_workers_mobile_phone.sql
--  作業員>詳細情報に本人の携帯電話番号を登録できるようにする。
--  追加のみDDL（ADD COLUMN・default無し=nullable）。破壊的変更なし。
-- ============================================================
alter table workers
  add column if not exists mobile_phone text;

comment on column workers.mobile_phone is '本人の携帯電話番号（任意）。緊急連絡先(emergency_contact)とは別項目。';
