-- ============================================================
--  20260920100000_inventory_movements_client_request_id.sql
--  在庫①（2026-09-19 /ship の独立レビュー（Gemini）指摘）:
--  作業員アプリからの移動登録に べき等キー（client_request_id）を持たせ、連打・通信断からの再送で
--  同じ登録が二重に増減しないようにする。
--
--  ★追加のみ（列＋部分一意index＋関数の引数追加）。既存の行は NULL（キー無し＝従来どおり毎回登録）。
--  ★inventory_move の 9引数版は「引数追加＋default」で置き換える（同じ名前付き引数で呼ぶと 9引数版と
--   10引数版が曖昧になる＝"function is not unique" を避けるため旧シグネチャは落とす）。
--   旧3引数版 inventory_move(uuid,integer,text)（admin の入出庫ボタン）は無関係・そのまま。
--  ロールバック: drop function inventory_move(uuid,integer,text,text,uuid,text[],uuid,text,date,uuid);
--                （必要なら 20260914150000 の 9引数版を再作成）
--                drop index inventory_movements_client_request_uidx; alter table inventory_movements drop column client_request_id;
-- ============================================================
alter table public.inventory_movements
  add column if not exists client_request_id uuid;

comment on column public.inventory_movements.client_request_id is
  '作業員アプリが1回の入力ごとに付けるべき等キー。同じ (account_id, client_request_id) の再送は登録せず現在庫をそのまま返す';

create unique index if not exists inventory_movements_client_request_uidx
  on public.inventory_movements (account_id, client_request_id)
  where client_request_id is not null;

drop function if exists public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date);

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
  p_client_request_id uuid default null
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
  -- ★べき等: 同じキーの登録が既にあれば何もせず現在庫を返す（再送で二重に増減しない）。
  --   品目行を for update で掴んだ後に見るので、同時再送も片方だけが通る（もう片方は一意indexで弾かれる前にここで止まる）。
  if p_client_request_id is not null and exists (
    select 1 from inventory_movements
     where account_id = v_item.account_id and client_request_id = p_client_request_id
  ) then
    return v_item;
  end if;
  -- 現場は同じテナントのものだけ
  if p_site_id is not null and not exists (select 1 from sites where id = p_site_id and account_id = v_item.account_id) then
    raise exception '現場が見つかりません';
  end if;

  insert into inventory_movements (account_id, item_id, delta, note, kind, site_id, photo_urls, created_by_worker_id, created_by_name, report_date, client_request_id)
  values (v_item.account_id, p_item_id, p_delta, nullif(btrim(coalesce(p_note, '')), ''), p_kind, p_site_id,
          coalesce(p_photo_urls, '{}'), p_created_by_worker_id, nullif(btrim(coalesce(p_created_by_name, '')), ''), p_report_date, p_client_request_id);

  update inventory_items
     set current_qty = current_qty + p_delta,
         updated_at  = now()
   where id = p_item_id
  returning * into v_item;
  return v_item;
end;
$$;

grant execute on function public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date, uuid) to authenticated, service_role;
revoke execute on function public.inventory_move(uuid, integer, text, text, uuid, text[], uuid, text, date, uuid) from anon;
