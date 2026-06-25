-- ============================================================
--  reminder_logs に kind 列を追加（daily / shaken の識別＝べき等化の単位を分離）
--  追加のみ（ADD COLUMN・既定 'daily' で既存行は後方互換）。
--  daily-reminder=kind'daily' / shaken-reminder=kind'shaken' で、
--  同一対象日に種別ごとに重複送信しないよう dedup する。
-- ============================================================
alter table reminder_logs add column if not exists kind text not null default 'daily';
create index if not exists reminder_logs_kind_date_idx
  on reminder_logs (account_id, kind, target_date);
