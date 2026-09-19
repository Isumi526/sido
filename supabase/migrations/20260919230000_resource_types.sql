-- ============================================================
--  20260919230000_resource_types.sql
--  リソース予定B-3：会議室・部屋、会社独自の予約対象（重機・プロジェクター…）の種類と台帳。
--  Notion: 【リソース予定B-3】 https://app.notion.com/p/3e00ff81c56b8110a403e654acf0ac14
--  設計: docs/spec/現場ステータス・リソース予定_認識合わせ_20260919.html 2-3
--
--  ★なぜ: 「会議室みたいなケースで、各テナントによって管理したいものが変わる」（2026-09-10 SEED）。
--   車両・道具は既存マスタを列に使うが、それ以外は「名前・写真・メモ」だけの簡単な台帳で足りる。
--   種類（resource_types）を会社ごとに増やせ、種類ごとに予定管理のタブになる。
--
--  ・resource_types: 会社独自の種類（key は会社内で一意・予約の resource_type に入る）。
--    標準の「会議室」は key='room' を「使う機能」（feature.rooms）で開閉し、台帳はこの resources を使う
--    （resource_types に行は要らない＝コード側の組み込み種類）。
--  ・resources: 種類ごとの対象（部屋1つ・重機1台…）。予約の resource_ref はこの id。
--  ★RLS: 読みは authenticated（account_id）、書きは EF 経由（service_role）。追加のみDDL。
-- ============================================================
create table if not exists public.resource_types (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  key           text not null,                       -- 予約の resource_type に入るキー（custom_xxxx）
  name          text not null,                       -- 表示名（重機・プロジェクター…）
  icon          text,                                -- Material Symbols 名（任意）
  block_overlap boolean not null default false,      -- 重なりを保存不可にするか（会議室型）
  require_time  boolean not null default false,      -- 時間帯を必須にするか
  enabled       boolean not null default true,       -- OFF＝タブを隠す（データは残す）
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint resource_types_key_uniq unique (account_id, key)
);
comment on table public.resource_types is '会社独自の予約対象の種類（予定管理のタブ）。標準の車両・道具・会議室はコード側の組み込み';

create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  type_key    text not null,                         -- 'room' または resource_types.key
  name        text not null,
  photo_url   text,
  note        text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.resources is '会議室・会社独自の予約対象の台帳（名前・写真・メモ）。予約の resource_ref はこの id';
create index if not exists resources_account_type_idx on public.resources (account_id, type_key, active, sort_order);

alter table public.resource_types enable row level security;
alter table public.resources      enable row level security;
drop policy if exists resource_types_sel on public.resource_types;
create policy resource_types_sel on public.resource_types for select to authenticated using (account_id = (select current_account_id()));
drop policy if exists resources_sel on public.resources;
create policy resources_sel on public.resources for select to authenticated using (account_id = (select current_account_id()));
revoke all on public.resource_types from anon;
revoke all on public.resources      from anon;
revoke insert, update, delete on public.resource_types from authenticated;
revoke insert, update, delete on public.resources      from authenticated;

-- ── ロールバック手順 ──
--   drop table if exists public.resources;
--   drop table if exists public.resource_types;
