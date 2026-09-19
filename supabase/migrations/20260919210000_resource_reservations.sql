-- ============================================================
--  20260919210000_resource_reservations.sql
--  リソース予定B-1：車両・道具・部屋など「もの」の予約（2026-09-19 設計どおりで承認）
--  Notion: 【リソース予定B-1】 https://app.notion.com/p/3e00ff81c56b8184a167ee24cc37a645
--  設計: docs/spec/現場ステータス・リソース予定_認識合わせ_20260919.html 2-2
--
--  ★なぜ: 「道具とか車両とか人以外のものの状況をリアルタイムで一覧表示したい」（2026-09-10 SEED）。
--   人の予定管理（日×作業員のマトリクス）と同じ形で、日×車両／日×道具 のタブを出す。
--   「使用中」は実績（道具のQR持出／日報の車両欄）から自動で埋め、人が入れるのは予約だけ。
--
--  ★1テーブルで全種類を持つ（resource_type ＋ resource_ref）。
--   車両＝vehicles.id、道具＝tools.id、会議室など汎用（B-3）＝resources.id。種類ごとに表を分けると
--   予定管理のタブを1種類足すたびにテーブル・EF・画面を増やすことになる。
--
--  ★RLS: 新規テーブルは最初から閉じる（ラチェット方針）。読みは authenticated に account_id で許可、
--   書きは EF（resource-reservations）経由＝service_role のみ（LIFF の作業員は EF で身元を解決する）。
--  ★追加のみDDL。
-- ============================================================
create table if not exists public.resource_reservations (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  -- 種類: vehicle / tool / room / （B-3 で会社独自の種類キー）
  resource_type   text not null,
  -- 対象の行ID（vehicles.id / tools.id / resources.id）。種類ごとに参照先が違うので FK は張らない
  resource_ref    uuid not null,
  worker_id       uuid references public.workers(id) on delete set null,     -- 使う人
  companions      uuid[] not null default '{}',                              -- 同乗者など（任意）
  site_id         uuid references public.sites(id) on delete set null,       -- 現場（任意）
  start_date      date not null,
  end_date        date not null,
  start_time      time,                                                      -- 任意（会議室は必須＝EFで検証）
  end_time        time,
  purpose         text,
  -- reserved=予約 / in_use=使用中 / done=終了 / canceled=取消
  status          text not null default 'reserved',
  created_by_worker_id uuid references public.workers(id) on delete set null,
  updated_by_worker_id uuid references public.workers(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint resource_reservations_status_check check (status in ('reserved', 'in_use', 'done', 'canceled')),
  constraint resource_reservations_period_check check (end_date >= start_date)
);
comment on table public.resource_reservations is
  '車両・道具・部屋などの予約（会社ごと）。使用中/終了は実績（道具QR・日報の車両欄）から自動遷移。';
comment on column public.resource_reservations.resource_type is 'vehicle / tool / room / 会社独自キー（B-3）';
comment on column public.resource_reservations.status is 'reserved=予約 / in_use=使用中 / done=終了 / canceled=取消';

create index if not exists resource_reservations_account_range_idx
  on public.resource_reservations (account_id, resource_type, start_date, end_date);
create index if not exists resource_reservations_resource_idx
  on public.resource_reservations (account_id, resource_ref, start_date);

create or replace function public.resource_reservations_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_resource_reservations_updated_at on public.resource_reservations;
create trigger trg_resource_reservations_updated_at
  before update on public.resource_reservations
  for each row execute function public.resource_reservations_set_updated_at();

-- ── RLS ──
alter table public.resource_reservations enable row level security;
drop policy if exists resource_reservations_sel on public.resource_reservations;
create policy resource_reservations_sel on public.resource_reservations
  for select to authenticated using (account_id = (select current_account_id()));
revoke all on public.resource_reservations from anon;
revoke insert, update, delete on public.resource_reservations from authenticated;

-- ── ロールバック手順 ──
--   drop table if exists public.resource_reservations;
