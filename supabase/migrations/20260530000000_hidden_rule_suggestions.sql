-- ============================================================
--  supabase/migrations/20260530000000
--  ルール候補の非表示リスト
--
--  「過去のルールから選択」プルダウンの候補は site_rules から
--  動的に集計しているため、不要な候補（古いもの・typo・test等）を
--  候補から隠すための非表示リストをアカウント単位で保持する。
--  ★実際の site_rules は一切削除しない（非破壊）
-- ============================================================

create table if not exists hidden_rule_suggestions (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  content    text not null,
  created_at timestamptz default now(),
  unique (account_id, content)
);

-- 管理画面（Supabase Auth 認証済み）からのみ操作するため RLS は無効化
-- （site_rules と同じ運用方針）
alter table hidden_rule_suggestions disable row level security;
