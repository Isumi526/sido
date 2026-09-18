-- ============================================================
--  20260914150000_inventory_movements_detail.sql
--  在庫①（2026-09-10 SEED 会議・2026-09-12 決定）:
--  移動記録に 種別（入荷/持出/引上げ/調整）・現場・写真・登録者・確認状態 を持たせる。
--
--  大塚「納品書で百本あっても…15本残ってましたよ…知らずに永遠と置いてある」＝目的は
--  「何がどれくらい残っているか」。作業員の最低限入力＝写真。
--  亥角「入荷／現場に持っていく／現場から引き戻ってくるタイミングで写真を撮って増減を登録する一手間」
--
--  ★追加のみ。既存の delta 加減（inventory_move(uuid,integer,text)）はそのまま動く（kind='adjust' 既定）。
--  ★会計在庫ではない（残数把握用）。閾値・使用枚数の記録は作らない（決定・要回答11=A）。
--  ロールバック: alter table inventory_movements drop column kind, site_id, photo_urls, created_by_worker_id, confirm_status, report_date;
--                drop function inventory_move(uuid,integer,text,text,uuid,text[],uuid,text,date);
-- ============================================================
alter table public.inventory_movements
  add column if not exists kind text not null default 'adjust'
    check (kind in ('in', 'out', 'return', 'adjust')),
  add column if not exists site_id uuid references public.sites(id) on delete set null,
  add column if not exists photo_urls text[] not null default '{}',
  add column if not exists created_by_worker_id uuid references public.workers(id) on delete set null,
  -- 在庫③（AI候補の確認役）で使う。①では 'unconfirmed' のまま
  add column if not exists confirm_status text not null default 'unconfirmed'
    check (confirm_status in ('unconfirmed', 'confirmed')),
  -- 日報の1問からの引き上げ登録は、どの日の日報からかを残す
  add column if not exists report_date date;

comment on column public.inventory_movements.kind is
  '移動の種別: in=入荷 / out=持出（現場へ） / return=引上げ（現場から戻す） / adjust=手動調整（admin の入出庫ボタン・旧データ）';
comment on column public.inventory_movements.site_id is '持出・引上げの相手先の現場';
comment on column public.inventory_movements.photo_urls is '登録時の写真（署名URL）。作業員の最低限入力＝写真';
comment on column public.inventory_movements.created_by_worker_id is '登録した作業員（LIFF からの登録。admin からは NULL で created_by_name のみ）';

create index if not exists inventory_movements_account_created_idx
  on public.inventory_movements (account_id, created_at desc);

-- 種別・現場・写真・登録者つきの入出庫。旧 inventory_move(uuid,integer,text) は残す（admin の既存呼び出し互換）。
-- ★security definer にしない。EF（service_role）と admin（authenticated＋RLS）のどちらから呼んでも
--  呼び出し側の権限で動く＝他テナントの品目は見つからない。
create or replace function public.inventory_move(
  p_item_id   uuid,
  p_delta     integer,
  p_note      text,
  p_kind      text,
  p_site_id   uuid,
  p_photo_urls text[],
  p_created_by_worker_id uuid,
  p_created_by_name text,
  p_report_date date default null
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
  -- 現場は同じテナントのものだけ
  if p_site_id is not null and not exists (select 1 from sites where id = p_site_id and account_id = v_item.account_id) then
    raise exception '現場が見つかりません';
  end if;

  insert into inventory_movements (account_id, item_id, delta, note, kind, site_id, photo_urls, created_by_worker_id, created_by_name, report_date)
  values (v_item.account_id, p_item_id, p_delta, nullif(btrim(coalesce(p_note, '')), ''), p_kind, p_site_id,
          coalesce(p_photo_urls, '{}'), p_created_by_worker_id, nullif(btrim(coalesce(p_created_by_name, '')), ''), p_report_date);

  update inventory_items
     set current_qty = current_qty + p_delta,
         updated_at  = now()
   where id = p_item_id
  returning * into v_item;
  return v_item;
end;
$$;

grant execute on function public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date) to authenticated, service_role;
revoke execute on function public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date) from anon;
