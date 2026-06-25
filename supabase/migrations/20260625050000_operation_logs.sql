-- ============================================================
--  操作ログ（operation_logs）: 下請け取引等の主要操作の日時・誰・何を記録
--  追加のみ（CREATE TABLE / INDEX / GRANT）。共通ログ基盤＝各機能から logOperation で記録。
-- ============================================================
create table if not exists operation_logs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  actor       text,                 -- 操作者（管理画面のログインemail等）
  action      text not null,        -- 操作種別（例: 請求登録 / 注文書送信 / 支払登録）
  target_type text,                 -- 対象種別（例: subcontractor_invoice / purchase_order）
  target_id   uuid,                 -- 対象ID
  summary     text,                 -- 一行サマリ（例: 業者名・金額）
  created_at  timestamptz not null default now()
);
alter table operation_logs disable row level security;
create index if not exists operation_logs_account_idx on operation_logs(account_id, created_at desc);
grant select, insert on operation_logs to anon, authenticated, service_role;
