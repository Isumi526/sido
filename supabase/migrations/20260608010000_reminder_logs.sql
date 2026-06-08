-- ============================================================
--  supabase/migrations/20260608010000
--  リマインド実行履歴（reminder_logs）
--   - daily-reminder が実行のたびに1アカウント1行を記録（管理画面で閲覧）
--   - 実行時間外スキップ等のノイズは関数側で記録対象から除外
-- ============================================================

create table if not exists reminder_logs (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(id),
  executed_at       timestamptz not null default now(),
  target_date       date,
  result            text not null,
  unsubmitted_count int not null default 0,
  recipients_count  int not null default 0,
  manual            boolean not null default false,
  created_at        timestamptz not null default now()
);

alter table reminder_logs disable row level security;

create index if not exists reminder_logs_account_idx
  on reminder_logs (account_id, executed_at desc);
