-- ============================================================
--  作業員に賃金タイプ（日当固定 / 時間給）を追加
--  追加のみ（ADD COLUMN・既定 'daily'＝既存は日当として後方互換）。
--  unit_price の意味: wage_type='daily'→日当(/8hで時給換算) / 'hourly'→時給(/h)。
-- ============================================================
alter table workers add column if not exists wage_type text not null default 'daily';
