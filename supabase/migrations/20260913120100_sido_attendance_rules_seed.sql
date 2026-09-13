-- ============================================================
--  20260913120100_sido_attendance_rules_seed.sql
--  株式会社SEED（slug=sido）の初期投入（データのみ・冪等）
--   - 作業区分「その他事務」→「オフィス」に改名（2026-09-13 亥角決定）
--   - 現場作業の確認ルール3件（過去の現場別ルールの文言から。ヘルメット6現場・安全靴3現場・長袖長ズボン3現場）
--  工場・オフィスのルールは大塚さんが管理画面で設定する（ここでは入れない）。
--  ★他テナント・ローカルには sido が無いので何もしない。
-- ============================================================
do $$
declare
  acc uuid;
  cat_site uuid;
begin
  select id into acc from public.accounts where slug = 'sido' limit 1;
  if acc is null then return; end if;

  update public.work_categories set name = 'オフィス'
   where account_id = acc and name = 'その他事務'
     and not exists (select 1 from public.work_categories w2 where w2.account_id = acc and w2.name = 'オフィス');

  select id into cat_site from public.work_categories where account_id = acc and name = '現場作業' limit 1;
  if cat_site is null then return; end if;

  insert into public.account_attendance_rules (account_id, work_category_id, content, timing, sort_order)
  select acc, cat_site, v.content, v.timing, v.ord
  from (values
    ('ヘルメット・安全帯を着用していますか', 'both',    100),
    ('長袖・長ズボンですか',                 'checkin', 101),
    ('安全靴を着用していますか',             'both',    102)
  ) as v(content, timing, ord)
  where not exists (
    select 1 from public.account_attendance_rules r
    where r.account_id = acc and r.work_category_id = cat_site and r.content = v.content
  );
end $$;
