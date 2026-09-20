-- ============================================================
--  20260920170000_work_categories_uses_site_hours.sql
--  作業区分の「現場作業」を名前でなくフラグで特定する（A-4・2026-09-20）。
--   uses_site_hours=true の区分＝「現場の固定勤務時刻を使う主系区分」。
--   これまで sites.vue / report.vue / calendar の3箇所が name==='現場作業' で特定していて、
--   改名・英語化した瞬間に壊れる状態だった。
--  ★追加のみ: 列追加＋既存の「現場作業」行を true に backfill＋標準区分のシード関数にも印を付ける。
-- ============================================================
alter table public.work_categories
  add column if not exists uses_site_hours boolean not null default false;
comment on column public.work_categories.uses_site_hours is
  '主系区分（現場の固定勤務時刻・既定休憩をそのまま使う）。日報の既定区分にもなる。名前で判定しない（改名に耐える）。テナントに1つ';

-- 既存テナント: 名前が「現場作業」の行を主系にする（テナントごとに1行だけ）
update public.work_categories set uses_site_hours = true
where name = '現場作業' and coalesce(uses_site_hours, false) = false;

-- 主系はテナントに1つ（部分一意）
create unique index if not exists work_categories_primary_uniq
  on public.work_categories (account_id) where uses_site_hours = true;

-- 標準区分のシード（新規テナント）にも印を付ける
create or replace function public.seed_default_work_categories()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.work_categories (account_id, name, scope, sort_order, is_default, uses_site_hours)
  values
    (new.id, '現場作業',  'site', 10, true, true),
    (new.id, '見積',      'site', 20, true, false),
    (new.id, 'その他事務', null,  30, true, false),
    (new.id, '講習',      null,  40, true, false),
    (new.id, '移動',      null,  50, true, false)
  on conflict (account_id, name) do nothing;
  return new;
end;
$$;
comment on function public.seed_default_work_categories is
  '新しい会社に標準の作業区分（現場作業/見積/その他事務/講習/移動）を入れる。現場作業は主系（uses_site_hours）。'
  ' 20260816030000 で追加、2026-08-17 に講習・移動、2026-09-20 に uses_site_hours。';
