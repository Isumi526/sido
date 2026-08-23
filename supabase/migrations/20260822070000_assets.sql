-- ============================================================
--  20260822060000_assets.sql
--  物品マスタ（assets）を導入する。第一弾は固定カテゴリ「ETCカード」。
--  Notion: GENLINKS に物品管理機能を追加する（固定カテゴリ ETC カード）#f948baa4
--
--  ★なぜ必要か:
--   日報の高速代で選ぶ ETC カードが report.vue にハードコード（カード①〜⑦）されており、
--   会社ごとに枚数も名前も変えられない。物品を会社ごとに管理できる置き場所を用意し、
--   日報側はこのマスタを参照する（マスタ空なら従来の固定値にフォールバックして壊さない）。
--
--  ★カテゴリは text で持つ（今は 'etc_card' のみ・将来他の物品を足せる）。
--  ★このマイグレーションは**追加のみ**。既存の列・データは触らない。
-- ============================================================

-- ── 物品マスタ（会社ごと）──────────────────────────────
create table if not exists public.assets (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  -- 物品カテゴリ。今は 'etc_card'（ETCカード）のみ。将来他の固定カテゴリを足せるよう text。
  category    text not null,
  name        text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 同一会社・同一カテゴリ内で名前は一意（丸一1 が重複しない）
  constraint assets_name_uniq unique (account_id, category, name)
);

comment on table public.assets is
  '物品マスタ（会社ごと）。第一弾は固定カテゴリ ETCカード（category=etc_card）。'
  ' 日報の高速代の ETCカード選択がこれを参照する。空なら report 側は従来の固定カード（カード①〜⑦）にフォールバックする。';
comment on column public.assets.category is
  '物品カテゴリ。etc_card=ETCカード。将来他の固定カテゴリを足せるよう text で持つ。';

create index if not exists assets_account_idx
  on public.assets (account_id, category, active, sort_order);

-- ── RLS（新規テーブルは最初から閉じる・2026-08-15 ラチェット方針）──────
--  anon は権限なし。読み書きは EF（master-data）経由にする。
alter table public.assets enable row level security;

drop policy if exists assets_sel on public.assets;
create policy assets_sel on public.assets
  for select to authenticated
  using (account_id = (select current_account_id()));

revoke all on public.assets from anon;
revoke insert, update, delete on public.assets from authenticated;

-- ── シードはしない ────────────────────────────────────
--  既存アカウントは当面 report 側のフォールバック（カード①〜⑦）で表示される。
--  admin の物品マスタ画面で枚数を指定して生成する（丸一1, 丸一2 …）。

-- ── ロールバック手順 ──────────────────────────────────
--   drop table if exists public.assets;
