-- ============================================================
--  経費 月次精算（申請/差し戻し）の状態テーブル
--  正典: docs/spec/expense.md §4
--  - 作業員 × 期(period_key: first/second) = 1 精算
--  - 行は申請が発生した時のみ作成（未申請/期限超過は行なしで導出）
--  - 追加のみ・後方互換。既存テーブル変更なし
-- ============================================================

create table if not exists expense_settlements (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references accounts(id) not null,
  user_id       uuid references users(id) on delete cascade not null,
  period_key    text not null,                 -- 'YYYY-MM-first' | 'YYYY-MM-second'
  status        text not null default '申請中', -- 申請中 / 差し戻し / 支払い済み
  applied_at    timestamptz,                   -- 申請(成立)日時
  pdf_path      text,                          -- expense-receipts 上の申請PDFパス
  reject_reason text,                          -- 差し戻し理由（差し戻し時必須）
  rejected_at   timestamptz,
  notified_at   timestamptz,                   -- メール送信済み時刻（二重送信防止）
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (account_id, user_id, period_key)
);

create index if not exists expense_settlements_account_period_idx
  on expense_settlements(account_id, period_key);
create index if not exists expense_settlements_user_idx
  on expense_settlements(user_id);

-- LIFF は anon キーで読み書きするため RLS 無効（既存 daily_reports/expense_items と同方針）
alter table expense_settlements disable row level security;
