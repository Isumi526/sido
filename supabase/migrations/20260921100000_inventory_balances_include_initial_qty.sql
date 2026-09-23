-- ─────────────────────────────────────────────────────────────────────
--  20260921100000_inventory_balances_include_initial_qty.sql
--  在庫④ /review（2026-09-21）で発見: 残数一覧は移動 delta の合計だけを見ていたため、
--  admin「追加」で初期在庫を直接 current_qty に入れた品目（在庫MVPからの登録の仕方）は
--  その分が残数一覧のどこにも出ず、「倉庫残数の合計＝現在庫」が成り立たなかった（実測 109 vs 9）。
--
--  直し: 品目ごとに  current_qty − Σdelta  を「拠点未指定」の倉庫行に足す。
--   ・移動記録が無い旧データ／初期在庫が「拠点未指定」に出るので、現在庫と残数一覧の合計が常に一致する
--   ・admin 側も初期在庫を adjust の移動記録として作るよう変更（同日）。この関数側の補正は
--     既存データ（本番の在庫MVP品目）のための恒久措置
--  可逆: 20260920120000 の定義に戻せば従来どおり（追加のみ・データ変更なし）
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.inventory_balances(p_account_id uuid)
returns table (
  item_id uuid, item_name text, unit text, category text, item_active boolean,
  location_kind text,          -- 'base'（拠点の倉庫）/ 'site'（現場）
  location_id uuid,            -- 拠点未指定は NULL
  location_name text,
  qty numeric,
  last_at timestamptz,
  last_photo_url text
)
language sql
security invoker
set search_path = public
stable
as $$
  with mv as (
    select m.*, coalesce(array_length(m.photo_urls, 1), 0) > 0 as has_photo
      from inventory_movements m
     where m.account_id = p_account_id
  ),
  base_mv as (
    -- 拠点（倉庫）: 全種別の delta の合計を拠点ごとに
    select item_id, base_site_id as location_id,
           sum(delta) as qty, max(created_at) as last_at,
           (array_agg(photo_urls[1] order by created_at desc) filter (where has_photo))[1] as last_photo_url
      from mv
     group by item_id, base_site_id
  ),
  residual as (
    -- ★初期在庫・移動記録の無い旧データ: current_qty − Σdelta を「拠点未指定」に
    select i.id as item_id, null::uuid as location_id,
           i.current_qty - coalesce((select sum(delta) from mv where mv.item_id = i.id), 0) as qty,
           null::timestamptz as last_at, null::text as last_photo_url
      from inventory_items i
     where i.account_id = p_account_id
  ),
  base as (
    select item_id, 'base'::text as location_kind, location_id,
           sum(qty) as qty, max(last_at) as last_at,
           (array_agg(last_photo_url) filter (where last_photo_url is not null))[1] as last_photo_url
      from (select * from base_mv union all select * from residual where qty <> 0) b
     group by item_id, location_id
  ),
  site as (
    -- 現場: 持出（delta<0）で増え、引上げ（delta>0）で減る ＝ -delta の合計
    select item_id, 'site'::text as location_kind, site_id as location_id,
           sum(-delta) as qty, max(created_at) as last_at,
           (array_agg(photo_urls[1] order by created_at desc) filter (where has_photo))[1] as last_photo_url
      from mv
     where kind in ('out', 'return') and site_id is not null
     group by item_id, site_id
  ),
  u as (select * from base union all select * from site)
  select u.item_id, i.name, i.unit, i.category, i.active,
         u.location_kind, u.location_id,
         case when u.location_kind = 'base' then coalesce(s.name, '拠点未指定') else s.name end as location_name,
         u.qty, u.last_at, u.last_photo_url
    from u
    join inventory_items i on i.id = u.item_id
    left join sites s on s.id = u.location_id
   where u.qty <> 0 or u.location_kind = 'base'
   order by i.category nulls last, i.name, u.location_kind, s.name nulls first
$$;
grant execute on function public.inventory_balances(uuid) to authenticated, service_role;
revoke execute on function public.inventory_balances(uuid) from anon;
