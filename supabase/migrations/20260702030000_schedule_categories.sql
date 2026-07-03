-- ============================================================
--  20260702030000_schedule_categories.sql
--  予定管理(カレンダー)のカテゴリをアカウント単位のマスタにし、色を管理者が編集できるように（#A）。
--   - schedule_categories: account_id × key で一意。label(表示名)/color/sort_order/active。
--   - 既定5カテゴリ(work/off/training/meeting/other)はアプリ側で「無ければ作る」方式でseed
--     （テナントごとにローカライズ済ラベルを入れるため migration では seed しない）。
--   - schedules.category の固定5値CHECK制約を解除（カスタムカテゴリ key を許可するため）。
--     ※ CHECK 解除は非破壊（データ喪失なし・検証の緩和のみ）。既存の end_date>=start_date CHECK(schedules_check)は維持。
--   - RLS は既存マスタ(sites/vehicles等)と同じく無効（マスタ層のRLS化は親エピックで一括）。
--   追加のみ寄り（CREATE TABLE / CREATE INDEX）＋ CHECK制約1本の DROP（非破壊）。
-- ============================================================

create table if not exists schedule_categories (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  key         text not null,                 -- 予定の category に入る識別子（既定: work/off/training/meeting/other、追加はslug）
  label       text not null,                 -- 表示名（現場管理者以上が編集可）
  color       text not null default '#06C755',
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists schedule_categories_account_key_uidx
  on schedule_categories (account_id, key);
create index if not exists schedule_categories_account_idx
  on schedule_categories (account_id);

alter table schedule_categories disable row level security;

-- schedules.category の固定5値CHECKを解除（カスタムカテゴリを許可）。非破壊（緩和のみ）。
alter table schedules drop constraint if exists schedules_category_check;
