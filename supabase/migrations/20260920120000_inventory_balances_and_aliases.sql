-- ============================================================
--  20260920120000_inventory_balances_and_aliases.sql
--  在庫④（2026-09-10 SEED 会議・設計書 I-3）: 残数一覧（拠点別・現場別）と品目の名寄せ（これ＝これ）。
--
--  ★残数の考え方（設計書 §2「資材の在庫＝品目×場所（拠点の倉庫または現場）の残数。入荷／持出／引上げで増減」）:
--   - 拠点（倉庫）の残数 = その拠点に紐づく移動の delta の合計（入荷+／持出−／引上げ+／調整±）＝ items.current_qty の拠点内訳
--   - 現場の残数       = 持出で現場へ行った数 − 引上げで戻った数（使った分は記録しない＝差し引かれない。既決定）
--   拠点は sites.kind in ('office','factory') の行（道具の保管場所と同じ定義・2026-09-13 決定）。
--   移動記録に base_site_id を持たせ、作業員アプリからの登録は workers.base_site_id（所属拠点）を既定にする。
--   拠点が付いていない移動（旧データ・admin の調整）は「拠点未指定」としてまとめて見せる。
--
--  ★名寄せ（AC2）: 「この品目＝この品目」を登録すると、寄せる側の移動記録・確認待ちを寄せ先へ付け替え、残数を合算し、
--   寄せる側は無効化する（見積の estimate_name_aliases と同じ「表記→正式」の記録を inventory_item_aliases に残す）。
--   以後、作業員アプリでその名前を新規登録しようとしても寄せ先が返る（EF item-create が aliases を見る）。
--   ★データ統合＝要人力確認カテゴリ。統合は1トランザクション・操作ログに残す。戻すには aliases 行を見て手で付け替える。
--
--  ★追加のみDDL（列・表・関数）。既存には触れない。
--  ロールバック: drop function inventory_merge_items(uuid,uuid,text); drop function inventory_balances(uuid);
--                inventory_move は 20260920100000 の10引数版に戻す（drop 11引数版→再作成）;
--                drop table inventory_item_aliases; alter table inventory_movements drop column base_site_id;
--                alter table inventory_pending_moves drop column base_site_id;
-- ============================================================
alter table public.inventory_movements
  add column if not exists base_site_id uuid references public.sites(id) on delete set null;
comment on column public.inventory_movements.base_site_id is
  '拠点（倉庫）＝現場マスタの office/factory 行。入荷・引上げはどの拠点の倉庫に入ったか／持出はどの拠点から出たか。NULL＝拠点未指定（旧データ・admin の調整）';
create index if not exists inventory_movements_account_base_idx
  on public.inventory_movements (account_id, base_site_id);
create index if not exists inventory_movements_account_site_idx
  on public.inventory_movements (account_id, site_id);

alter table public.inventory_pending_moves
  add column if not exists base_site_id uuid references public.sites(id) on delete set null;

-- inventory_move に拠点（p_base_site_id）を追加（10引数版は同日の 20260920100000 で作ったばかり・未リリースなので置き換える）
drop function if exists public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date, uuid);
create or replace function public.inventory_move(
  p_item_id   uuid,
  p_delta     integer,
  p_note      text,
  p_kind      text,
  p_site_id   uuid,
  p_photo_urls text[],
  p_created_by_worker_id uuid,
  p_created_by_name text,
  p_report_date date default null,
  p_client_request_id uuid default null,
  p_base_site_id uuid default null
) returns inventory_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item inventory_items;
begin
  if p_delta = 0 then
    raise exception '増減が0です';
  end if;
  if p_kind not in ('in', 'out', 'return', 'adjust') then
    raise exception '種別が不正です';
  end if;
  select * into v_item from inventory_items where id = p_item_id for update;
  if not found then
    raise exception '品目が見つかりません';
  end if;
  if p_client_request_id is not null and exists (
    select 1 from inventory_movements
     where account_id = v_item.account_id and client_request_id = p_client_request_id
  ) then
    return v_item;
  end if;
  if p_site_id is not null and not exists (select 1 from sites where id = p_site_id and account_id = v_item.account_id) then
    raise exception '現場が見つかりません';
  end if;
  -- 拠点は同じテナントの office/factory 行だけ
  if p_base_site_id is not null and not exists (
    select 1 from sites where id = p_base_site_id and account_id = v_item.account_id and kind in ('office', 'factory')
  ) then
    raise exception '拠点が見つかりません';
  end if;

  insert into inventory_movements (account_id, item_id, delta, note, kind, site_id, photo_urls, created_by_worker_id, created_by_name, report_date, client_request_id, base_site_id)
  values (v_item.account_id, p_item_id, p_delta, nullif(btrim(coalesce(p_note, '')), ''), p_kind, p_site_id,
          coalesce(p_photo_urls, '{}'), p_created_by_worker_id, nullif(btrim(coalesce(p_created_by_name, '')), ''), p_report_date, p_client_request_id, p_base_site_id);

  update inventory_items
     set current_qty = current_qty + p_delta,
         updated_at  = now()
   where id = p_item_id
  returning * into v_item;
  return v_item;
end;
$$;
grant execute on function public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date, uuid, uuid) to authenticated, service_role;
revoke execute on function public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date, uuid, uuid) from anon;

-- 名寄せの記録（寄せた側の名前 → 寄せ先の品目）
create table if not exists public.inventory_item_aliases (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id),
  alias_item_id    uuid not null references public.inventory_items(id) on delete cascade,   -- 寄せた側（無効化される）
  alias_name       text not null,                                                            -- 寄せた側の名前（検索用・正規化前）
  item_id          uuid not null references public.inventory_items(id) on delete cascade,   -- 寄せ先
  merged_qty       numeric not null default 0,                                               -- 統合時に寄せ先へ足した残数（戻す時の手がかり）
  merged_movements integer not null default 0,
  created_by_name  text,
  created_at       timestamptz not null default now()
);
comment on table public.inventory_item_aliases is
  '在庫④ 品目の名寄せ（これ＝これ）。alias_item_id の移動記録・残数は item_id へ統合済み。以後 alias_name の新規登録は item_id を返す';
create index if not exists inventory_item_aliases_account_idx on public.inventory_item_aliases (account_id, item_id);
create unique index if not exists inventory_item_aliases_alias_uidx on public.inventory_item_aliases (account_id, alias_item_id);

do $$ declare t text;
begin
  foreach t in array array['inventory_item_aliases'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists %I_sel on %I', t, t);
    execute format('create policy %I_sel on %I for select to authenticated using (account_id = (select public.current_account_id()))', t, t);
    execute format('drop policy if exists %I_ins on %I', t, t);
    execute format('create policy %I_ins on %I for insert to authenticated with check (account_id = (select public.current_account_id()))', t, t);
    execute format('drop policy if exists %I_upd on %I', t, t);
    execute format('create policy %I_upd on %I for update to authenticated using (account_id = (select public.current_account_id()))', t, t);
    execute format('drop policy if exists %I_del on %I', t, t);
    execute format('create policy %I_del on %I for delete to authenticated using (account_id = (select public.current_account_id()))', t, t);
  end loop;
end $$;

-- ── 残数一覧（拠点別・現場別）。security invoker: admin は RLS で自社分だけ、EF は service_role で p_account_id を渡す ──
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
  base as (
    -- 拠点（倉庫）: 全種別の delta の合計を拠点ごとに
    select item_id, 'base'::text as location_kind, base_site_id as location_id,
           sum(delta) as qty, max(created_at) as last_at,
           (array_agg(photo_urls[1] order by created_at desc) filter (where has_photo))[1] as last_photo_url
      from mv
     group by item_id, base_site_id
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

-- ── 名寄せ（統合）: p_from（寄せる側）の移動記録・確認待ち・訂正履歴を p_into（寄せ先）へ付け替え、残数を合算、p_from を無効化 ──
create or replace function public.inventory_merge_items(
  p_from uuid,
  p_into uuid,
  p_by   text
) returns inventory_item_aliases
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from inventory_items;
  v_into inventory_items;
  v_n integer;
  v_alias inventory_item_aliases;
begin
  if p_from = p_into then
    raise exception '同じ品目です';
  end if;
  -- 2行を id 順にロック（別の統合と同時でもデッドロックしない）
  perform 1 from inventory_items where id in (p_from, p_into) order by id for update;
  select * into v_from from inventory_items where id = p_from;
  if not found then raise exception '寄せる品目が見つかりません'; end if;
  select * into v_into from inventory_items where id = p_into;
  if not found then raise exception '寄せ先の品目が見つかりません'; end if;
  if v_from.account_id <> v_into.account_id then raise exception '別の会社の品目です'; end if;
  if not v_into.active then raise exception '寄せ先が無効です'; end if;
  if exists (select 1 from inventory_item_aliases where alias_item_id = p_from) then
    raise exception '既に名寄せ済みです';
  end if;

  update inventory_movements set item_id = p_into where item_id = p_from;
  get diagnostics v_n = row_count;
  update inventory_pending_moves set suggested_item_id = p_into where suggested_item_id = p_from;
  update inventory_pending_moves set item_id = p_into where item_id = p_from;
  update inventory_item_corrections set item_id = p_into where item_id = p_from;

  update inventory_items
     set current_qty = current_qty + v_from.current_qty, updated_at = now()
   where id = p_into;
  update inventory_items
     set active = false, current_qty = 0, updated_at = now()
   where id = p_from;

  insert into inventory_item_aliases (account_id, alias_item_id, alias_name, item_id, merged_qty, merged_movements, created_by_name)
  values (v_from.account_id, p_from, v_from.name, p_into, v_from.current_qty, v_n, nullif(btrim(coalesce(p_by, '')), ''))
  returning * into v_alias;
  return v_alias;
end;
$$;
grant execute on function public.inventory_merge_items(uuid, uuid, text) to authenticated, service_role;
revoke execute on function public.inventory_merge_items(uuid, uuid, text) from anon;

-- 確定時に拠点も移動記録へ引き継ぐ（inventory_confirm_pending の再定義・引数は同じ）
create or replace function public.inventory_confirm_pending(
  p_pending_id uuid,
  p_item_id    uuid,
  p_decided_by_name text,
  p_reject_reason   text default null
) returns inventory_pending_moves
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p inventory_pending_moves;
  v_item inventory_items;
  v_mv_id uuid;
begin
  select * into v_p from inventory_pending_moves where id = p_pending_id for update;
  if not found then
    raise exception '確認待ちが見つかりません';
  end if;
  if v_p.status <> 'pending' then
    raise exception '既に処理済みです';
  end if;

  if p_item_id is null then
    update inventory_pending_moves
       set status = 'rejected', decided_at = now(), decided_by_name = nullif(btrim(coalesce(p_decided_by_name, '')), ''),
           reject_reason = nullif(btrim(coalesce(p_reject_reason, '')), '')
     where id = p_pending_id
     returning * into v_p;
    return v_p;
  end if;

  if not exists (select 1 from inventory_items where id = p_item_id and account_id = v_p.account_id and active) then
    raise exception '品目が見つかりません';
  end if;

  v_item := inventory_move(
    p_item_id, case when v_p.kind = 'out' then -v_p.qty else v_p.qty end, v_p.note, v_p.kind, v_p.site_id,
    v_p.photo_urls, v_p.created_by_worker_id, v_p.created_by_name, v_p.report_date, v_p.id, v_p.base_site_id
  );
  select id into v_mv_id from inventory_movements
   where account_id = v_p.account_id and client_request_id = v_p.id;
  if v_mv_id is null then
    raise exception '移動記録を作れませんでした';
  end if;
  update inventory_movements set confirm_status = 'confirmed' where id = v_mv_id;

  update inventory_pending_moves
     set status = 'confirmed', item_id = p_item_id, movement_id = v_mv_id,
         decided_at = now(), decided_by_name = nullif(btrim(coalesce(p_decided_by_name, '')), '')
   where id = p_pending_id
   returning * into v_p;
  return v_p;
end;
$$;
