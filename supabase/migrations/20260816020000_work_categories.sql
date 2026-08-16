-- ============================================================
--  20260816020000_work_categories.sql
--  作業区分（現場作業/見積/その他事務）と「現場×区分」ごとの定時を導入する
--  Notion: 作業区分を導入し、定時を「現場×区分」に持たせる
--
--  ★なぜ必要か（2026-08-15〜16 の実測）:
--   1つの現場に対して作業の種類が複数ある（現場作業のほかに見積もり・事務）。
--   それらは現場の定時の外で行う。今は定時が「現場ごと」に1組しか無いので表現できない。
--
--   区分の置き場所が無いため、現場マスタに区分を作ってしのいでいた。
--   sido の有効な現場80件のうち8件が実質「作業区分」だった:
--     事務、その他、名古屋 / 事務、その他、東京 / 見積 / 工場作業、その他 /
--     安全衛生講習 / 有給 / 半有給（hiromokkou は 研修／勉強会）
--
--  ★定時は「現場だけ」のものでも「区分だけ」のものでもない。
--   `事務、その他、東京` は 08:30〜18:30、`事務、その他、名古屋` は 08:00〜18:30 と
--   **拠点で違う**。既に同じ列に現場の定時と区分の定時が混在している。
--   だから (現場, 区分) の組に持たせる。
--
--  ★有給はここに入れない（別軸）。
--   勤怠区分（daily_reports.is_working + leave_type）のまま。
--   「有給という作業を現場に対して行った」は意味を成さない。
--
--  ★このマイグレーションは**追加のみ**。既存の列・データは触らない。
--   sites.default_start_time 等は残したまま新しい置き場所を用意し、
--   移行は別ステップ（元に戻せる形で）で行う。
-- ============================================================

-- ── 作業区分マスタ（会社ごと）──────────────────────────
--  ★現場ごとではなく会社ごと。現場80件×区分5種を現場ごとに作ると 400 の管理になる。
create table if not exists public.work_categories (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  -- どの台帳で使えるか。'site'=現場 / 'office'=事務所 / 'event'=社内行事 / null=どこでも
  --  ★全区分がどの台帳でも出ると鬱陶しい（慰安旅行が全現場の選択肢に出てしまう）。
  scope       text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  -- 標準で用意した区分か。UI で「削除してよいか」の判断に使う（削除自体は可能）
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint work_categories_name_uniq unique (account_id, name)
);

comment on table public.work_categories is
  '作業区分マスタ（会社ごと）。現場作業/見積/その他事務など。'
  ' 現場に対する「作業の種類」であって、勤怠区分（有給等）とは別軸。'
  ' 有給は daily_reports.leave_type で持つ——ここに入れないこと。';
comment on column public.work_categories.scope is
  'どの台帳で使えるか。site=現場 / office=事務所 / event=社内行事 / null=どこでも。'
  ' 全区分をどの台帳にも出すと選択肢が鬱陶しくなるため絞る。';

create index if not exists work_categories_account_idx
  on public.work_categories (account_id, active, sort_order);

-- ── 現場×区分ごとの定時 ────────────────────────────────
--  ★定時が無い区分（見積・事務など）は行を作らないか、時刻を null にする。
--   「行が無い＝定時なし」で扱えるようにしておく。
create table if not exists public.site_category_hours (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  site_id               uuid not null references public.sites(id) on delete cascade,
  category_id           uuid not null references public.work_categories(id) on delete cascade,
  default_start_time    time,
  default_end_time      time,
  default_break_minutes integer,
  -- 時間帯ごとの休憩（例 10:00/15分・12:00/60分）。sites.default_breaks と同じ形
  default_breaks        jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint site_category_hours_uniq unique (site_id, category_id)
);

comment on table public.site_category_hours is
  '現場×作業区分ごとの定時・休憩。'
  ' ★定時は「現場だけ」でも「区分だけ」でも決まらない（事務は拠点で 08:30/08:00 と違う）。'
  ' 行が無い＝その組に定時なし。sites.default_* は移行が済むまで残す。';

create index if not exists site_category_hours_site_idx
  on public.site_category_hours (account_id, site_id);

-- ── 日報・予定に「どの区分の作業か」を持たせる ──────────────
--  日報は sites JSON の中に持つ（現場ごとに区分が変わるため）。ここでは予定側だけ。
alter table public.schedules
  add column if not exists category_id uuid references public.work_categories(id);

comment on column public.schedules.category_id is
  '作業区分。既定は「現場作業」（入力項目が増えて戸惑わないよう最初から選択済みにする）。';

-- ── RLS（新規テーブルは最初から閉じる）──────────────────
--  ★2026-08-15 のラチェット方針: 新しい表を RLS 無効で作らない。
--   anon は権限なし。読み書きは EF（master-data）経由にする。
alter table public.work_categories   enable row level security;
alter table public.site_category_hours enable row level security;

drop policy if exists work_categories_sel on public.work_categories;
create policy work_categories_sel on public.work_categories
  for select to authenticated
  using (account_id = (select current_account_id()));

drop policy if exists site_category_hours_sel on public.site_category_hours;
create policy site_category_hours_sel on public.site_category_hours
  for select to authenticated
  using (account_id = (select current_account_id()));

revoke all on public.work_categories from anon;
revoke all on public.site_category_hours from anon;
revoke insert, update, delete on public.work_categories from authenticated;
revoke insert, update, delete on public.site_category_hours from authenticated;

-- ── 標準の区分を全アカウントへ入れる ──────────────────────
--  現場作業 / 見積 / その他事務。不要なら削除できる（固定にしない）。
insert into public.work_categories (account_id, name, scope, sort_order, is_default)
select a.id, v.name, v.scope, v.sort_order, true
from public.accounts a
cross join (values
  ('現場作業', 'site',   10),
  ('見積',     'site',   20),
  ('その他事務', null,   30)
) as v(name, scope, sort_order)
on conflict (account_id, name) do nothing;

-- ── ロールバック手順 ────────────────────────────────
--   drop table if exists public.site_category_hours;
--   drop table if exists public.work_categories cascade;   -- schedules.category_id の FK も落ちる
--   alter table public.schedules drop column if exists category_id;
--   （既存の sites.default_* は触っていないので、これだけで元に戻る）
