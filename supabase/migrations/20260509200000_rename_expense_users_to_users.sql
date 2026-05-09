-- ============================================================
--  supabase/migrations/20260509200000
--  expense_users → users にリネーム（全社システム化対応）
--  FK 制約 (daily_reports.user_id, expense_items.user_id) は
--  Postgres がリネーム時に自動追従するため変更不要
-- ============================================================

alter table expense_users rename to users;

-- RLS 無効化（anon キー直アクセスのため）
alter table users disable row level security;
