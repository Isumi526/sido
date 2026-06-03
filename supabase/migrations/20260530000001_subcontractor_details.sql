-- ============================================================
--  supabase/migrations/20260530000001
--  下請け業者の詳細登録・検索機能
--
--  既存の subcontractors（名前マスタ）を拡張し、
--  工種・対応エリア・コメント・編集履歴・論理削除/マージを追加する。
--
--  方針（既存コードベースに準拠）:
--   - マルチテナント: 全テーブルに account_id。クエリ側で account 絞り込み。
--   - RLS: subcontractors と同様に基本「無効」。コメントの本人制限はアプリ側で実施
--     （LIFFは anon キーで auth.uid()=null のため auth.uid() ベースの RLS は機能しない）。
--   - edit_logs だけは「LIFFから記録のみ・閲覧はadminのみ」を RLS で実現。
-- ============================================================

-- ── subcontractors 拡張（全てNULL許容＝既存データ保護） ──────────
alter table subcontractors
  add column if not exists representative_name text,
  add column if not exists mobile_phone        text,
  add column if not exists office_phone         text,
  add column if not exists email                text,
  add column if not exists service_areas        text[] default '{}',
  add column if not exists registered_by        uuid references workers(id),
  add column if not exists is_deleted           boolean default false,
  add column if not exists deleted_by           uuid references workers(id),
  add column if not exists deleted_at           timestamptz;

-- 対応エリア（配列）の contains 検索用
create index if not exists subcontractors_service_areas_gin
  on subcontractors using gin (service_areas);

-- subcontractors は RLS 無効のまま（ENABLE しない）

-- ── 工種・中間テーブル ────────────────────────────────────────
create table if not exists subcontractor_trade_types (
  id               uuid primary key default gen_random_uuid(),
  subcontractor_id uuid references subcontractors(id) on delete cascade,
  account_id       uuid references accounts(id),
  trade_type       text not null,
  created_at       timestamptz default now()
);
create index if not exists sub_trade_types_sub_idx   on subcontractor_trade_types(subcontractor_id);
create index if not exists sub_trade_types_type_idx  on subcontractor_trade_types(trade_type);
alter table subcontractor_trade_types disable row level security;

-- ── 工種プリセットマスタ ──────────────────────────────────────
create table if not exists trade_type_presets (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  name        text not null,
  category    text not null
              check (category in ('下地・造作工事','仕上げ工事','設備工事')),
  is_preset   boolean default false,
  sort_order  int default 0,
  created_by  uuid references workers(id),
  created_at  timestamptz default now(),
  unique (name, account_id)
);
alter table trade_type_presets disable row level security;

-- 初期プリセット（全既存アカウントに投入）
insert into trade_type_presets (name, category, is_preset, sort_order, account_id)
select v.name, v.category, true, v.sort_order, a.id
from accounts a
cross join (values
  ('軽鉄（LGS）工事',     '下地・造作工事', 1),
  ('ボード工事',           '下地・造作工事', 2),
  ('木工・造作工事',       '下地・造作工事', 3),
  ('左官工事',             '下地・造作工事', 4),
  ('クロス（壁紙）工事',   '仕上げ工事',     5),
  ('塗装工事',             '仕上げ工事',     6),
  ('床仕上げ工事',         '仕上げ工事',     7),
  ('木製・金属製建具工事', '仕上げ工事',     8),
  ('電気設備工事',         '設備工事',       9),
  ('空調・換気設備工事',   '設備工事',       10),
  ('給排水衛生設備工事',   '設備工事',       11)
) as v(name, category, sort_order)
on conflict (name, account_id) do nothing;

-- ── コメント ─────────────────────────────────────────────────
create table if not exists subcontractor_comments (
  id               uuid primary key default gen_random_uuid(),
  subcontractor_id uuid references subcontractors(id) on delete cascade,
  account_id       uuid references accounts(id),
  worker_id        uuid references workers(id),
  content          text not null,
  is_deleted       boolean default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index if not exists sub_comments_sub_idx on subcontractor_comments(subcontractor_id);
-- 本人のみ編集/削除はアプリ側（worker_id 照合）で実施するため RLS は無効
alter table subcontractor_comments disable row level security;

-- ── 編集履歴 ─────────────────────────────────────────────────
create table if not exists subcontractor_edit_logs (
  id               uuid primary key default gen_random_uuid(),
  subcontractor_id uuid references subcontractors(id),
  account_id       uuid references accounts(id),
  edited_by        uuid references workers(id),
  action           text check (action in ('create','update','delete','restore','merge')),
  changes          jsonb,
  created_at       timestamptz default now()
);
create index if not exists sub_edit_logs_sub_idx on subcontractor_edit_logs(subcontractor_id);

-- edit_logs のみ RLS 有効: LIFF(anon)から記録だけ可・閲覧はadminのみ
alter table subcontractor_edit_logs enable row level security;

drop policy if exists "anyone_insert_edit_logs" on subcontractor_edit_logs;
create policy "anyone_insert_edit_logs"
on subcontractor_edit_logs for insert
with check (true);

drop policy if exists "admin_read_edit_logs" on subcontractor_edit_logs;
create policy "admin_read_edit_logs"
on subcontractor_edit_logs for select
using (is_admin(auth.uid()));
