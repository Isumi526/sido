-- ============================================================
--  supabase/migrations/20260621000000_vehicles_management
--  車両管理: vehicles マスタを拡張 + 修理ログテーブル追加（追加のみDDL）
--   - 車検年月日 / ナンバー / スタッドレス有無 / 保険加入有無+内容 / 修理ログ
--   - RLS は既存マスタ（workers/sites/subcontractors）と同じく無効のまま
--     （マスタのRLS化は別チケット「本番DBのRLS有効化」で一括対応）
-- ============================================================

-- ── vehicles 拡張（追加のみ・冪等）──────────────────────────
alter table vehicles add column if not exists plate_number   text;        -- ナンバー
alter table vehicles add column if not exists inspection_date date;        -- 車検年月日
alter table vehicles add column if not exists has_studless    boolean not null default false;  -- スタッドレス有無
alter table vehicles add column if not exists has_insurance   boolean not null default false;  -- 保険加入有無
alter table vehicles add column if not exists insurance_note  text;        -- 保険の内容（軽く）

-- ── 修理ログ ────────────────────────────────────────────────
create table if not exists vehicle_repair_logs (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  account_id  uuid references accounts(id),
  repair_date date not null,
  description text not null,
  cost        int,
  created_at  timestamptz not null default now()
);

create index if not exists idx_vehicle_repair_logs_vehicle on vehicle_repair_logs (vehicle_id);
create index if not exists idx_vehicle_repair_logs_account on vehicle_repair_logs (account_id);

-- 既存マスタと同じ運用（RLSは別チケットで一括対応）
alter table vehicle_repair_logs disable row level security;
