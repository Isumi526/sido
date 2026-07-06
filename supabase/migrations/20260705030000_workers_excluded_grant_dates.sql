-- ============================================================
--  20260705030000_workers_excluded_grant_dates.sql
--  有給の法令自動付与から「恒久除外する基準日」を作業員ごとに記録（A＋修正の除外機能）。
--   - 自動付与は入社日基準の法令スケジュールを常に維持するため、単純削除だと再読込で復活する。
--     本カラムに除外する基準日(granted_at)を持たせ、自動付与・付与待ち検知・まとめて付与が
--     その基準日をスキップ＝削除を恒久化できる（出勤率8割未満・休職・特殊ケース等）。
--   - 誤って除外したら UI の「除外解除」で戻せる。
--   追加のみDDL（ADD COLUMN・jsonb配列 default []）。非破壊・後方互換。
-- ============================================================
alter table workers
  add column if not exists excluded_grant_dates jsonb not null default '[]'::jsonb;

comment on column workers.excluded_grant_dates is '法令自動付与から恒久除外する基準日(granted_at)の配列。削除操作で追加・除外解除で除去。';
