-- ============================================================
--  supabase/migrations/20260509400000
--  マルチテナント対応基盤: accounts テーブル追加
--  現時点では1社のみ。将来的に複数社への拡張を想定。
--
--  ⚠ account_id は今は nullable で追加（既存データのみ埋める）
--  NOT NULL 制約は各テーブルのコードを更新してから別マイグレで追加する
-- ============================================================

-- ── アカウント（会社）マスタ ──────────────────────────────
create table if not exists accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,           -- 将来: サブドメイン等の識別子
  created_at timestamptz not null default now()
);

insert into accounts (name, slug) values ('Sample Construction Co.', 'seed');

alter table accounts disable row level security;

-- ── 既存テーブルに account_id を追加（nullable）──────────
-- 既存レコードはすべて seed アカウントに紐付け
-- 新規insertはコード側で渡すまで null を許容

alter table users
  add column if not exists account_id uuid references accounts(id);
update users
  set account_id = (select id from accounts where slug = 'seed')
  where account_id is null;

alter table settings
  add column if not exists account_id uuid references accounts(id);
update settings
  set account_id = (select id from accounts where slug = 'seed')
  where account_id is null;

alter table daily_reports
  add column if not exists account_id uuid references accounts(id);
update daily_reports
  set account_id = (select id from accounts where slug = 'seed')
  where account_id is null;
