-- ============================================================
--  20260918120000_tools.sql
--  道具管理①：道具マスタ・保管場所マスタ（拠点＞保管場所の2段）・道具イベント（②で使う器）
--  Notion: 【道具①】道具マスタと保管場所マスタを作り、adminで登録→QR自動発行・面付け印刷
--         https://app.notion.com/p/3d90ff81c56b818fb7f5c118979b97e0
--
--  ★なぜ必要か（2026-09-10 SEED 会議・大塚 G+1:28:14）:
--   レーザー・脚立など数十万円の共有道具が「電話して誰さんが大阪に持ってったとか」で行方不明になる。
--   決定（2026-09-12・要回答7=B）: 最初から「場所QR→道具QRの二重読み＋位置情報」で作る。
--
--  ★ETCカード等の物品管理（assets）とは別テーブル。assets は「日報で選ぶ消耗系の物品」、
--   tools は「所在を追う共有道具」で、持つ列も履歴の形も違う（干渉させない）。
--
--  ★このマイグレーションは**追加のみ**。既存の列・データは触らない。
-- ============================================================

-- ── 保管場所マスタ（拠点＞保管場所の2段）──────────────────
--  例: 名古屋＞倉庫1・倉庫2・コンテナ／東京＞倉庫1。
--  2段は列で持つ（base=拠点, name=保管場所）。階層テーブルにしない＝会議で出た深さは2段固定で、
--  QR は「場所」単位で1枚（拠点だけのQRは作らない）。
create table if not exists public.tool_locations (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  base        text not null,                     -- 拠点（名古屋・東京 …）
  name        text not null,                     -- 保管場所（倉庫1・コンテナ …）
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tool_locations_name_uniq unique (account_id, base, name)
);
comment on table public.tool_locations is
  '道具の保管場所マスタ（会社ごと・拠点＞保管場所の2段）。場所QRの単位。';

create index if not exists tool_locations_account_idx
  on public.tool_locations (account_id, active, base, sort_order);

-- ── 道具マスタ ─────────────────────────────────────
create table if not exists public.tools (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  name          text not null,                  -- 道具名（レーザー墨出し器 A）
  kind          text,                           -- 種別（レーザー・脚立・電動工具 …）。自由入力
  code          text,                           -- 管理番号（任意。棚卸しリストの番号など）
  location_id   uuid references public.tool_locations(id) on delete set null,   -- 定位置（返す場所）
  photo_url     text,
  -- 状態: available=保管中 / out=持出中 / lost=行方不明 / broken=故障・修理中 / retired=廃棄
  --  ②の持出/返却が out/available を動かす。①では登録時の初期値だけ。
  status        text not null default 'available',
  holder_worker_id uuid references public.workers(id) on delete set null,       -- 今の所持者（②で更新）
  site_id       uuid references public.sites(id) on delete set null,           -- 今の持出先（②で更新）
  note          text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tools_status_check check (status in ('available', 'out', 'lost', 'broken', 'retired'))
);
comment on table public.tools is
  '共有道具マスタ（会社ごと）。QR を道具1個に1枚発行し、②で持出/返却を場所QR→道具QRの二重読みで記録する。';
comment on column public.tools.status is
  'available=保管中 / out=持出中 / lost=行方不明 / broken=故障・修理中 / retired=廃棄';

create index if not exists tools_account_idx
  on public.tools (account_id, active, name);
create index if not exists tools_location_idx
  on public.tools (account_id, location_id);

-- ── 道具イベント（②の持出・返却・所持者移転で使う器。①では作るだけ）──
create table if not exists public.tool_events (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  tool_id         uuid not null references public.tools(id) on delete cascade,
  -- checkout=持出 / return=返却 / transfer=又貸し（所持者移転） / adjust=管理者の状態変更
  kind            text not null,
  worker_id       uuid references public.workers(id) on delete set null,       -- 操作した人（＝新しい所持者）
  from_worker_id  uuid references public.workers(id) on delete set null,       -- transfer の前の所持者
  site_id         uuid references public.sites(id) on delete set null,         -- 持出先
  location_id     uuid references public.tool_locations(id) on delete set null, -- 返却先（場所QR）
  lat             double precision,
  lng             double precision,
  photo_urls      text[] not null default '{}',
  note            text,
  created_at      timestamptz not null default now(),
  constraint tool_events_kind_check check (kind in ('checkout', 'return', 'transfer', 'adjust'))
);
comment on table public.tool_events is
  '道具の持出・返却・又貸し・状態変更の履歴。位置情報つき。①では器だけ作り、②で書く。';

create index if not exists tool_events_tool_idx
  on public.tool_events (account_id, tool_id, created_at desc);

-- ── RLS（新規テーブルは最初から閉じる・2026-08-15 ラチェット方針）──────
--  anon は権限なし。読みは authenticated（admin）に account_id で絞って許可。
--  書きは EF（tools）経由＝service_role のみ。
alter table public.tool_locations enable row level security;
alter table public.tools          enable row level security;
alter table public.tool_events    enable row level security;

drop policy if exists tool_locations_sel on public.tool_locations;
create policy tool_locations_sel on public.tool_locations
  for select to authenticated using (account_id = (select current_account_id()));
drop policy if exists tools_sel on public.tools;
create policy tools_sel on public.tools
  for select to authenticated using (account_id = (select current_account_id()));
drop policy if exists tool_events_sel on public.tool_events;
create policy tool_events_sel on public.tool_events
  for select to authenticated using (account_id = (select current_account_id()));

revoke all on public.tool_locations from anon;
revoke all on public.tools          from anon;
revoke all on public.tool_events    from anon;
revoke insert, update, delete on public.tool_locations from authenticated;
revoke insert, update, delete on public.tools          from authenticated;
revoke insert, update, delete on public.tool_events    from authenticated;

-- ── シードはしない（SEED 側の棚卸しリストを admin の CSV 取込で入れる）──

-- ── ロールバック手順 ──────────────────────────────────
--   drop table if exists public.tool_events;
--   drop table if exists public.tools;
--   drop table if exists public.tool_locations;
