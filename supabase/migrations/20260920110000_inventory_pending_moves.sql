-- ============================================================
--  20260920110000_inventory_pending_moves.sql
--  在庫③（2026-09-10 SEED 会議・要回答9=C・設計書 I-2）:
--  AI候補の「確認役」を会社ごとに選べる。既定＝申請者本人（self）がその場で品目を確定。
--  設定で「事務側（office）」にすると、作業員は写真＋数量（＋AIの候補）だけで送り、
--  事務側が管理画面の「未確認一覧」で品目を確定してから在庫に反映する。
--
--  ★なぜ別表か: inventory_movements の1行＝「在庫が実際に動いた記録」を崩さない。
--   品目が決まっていない登録は残数に触れない「確認待ち」として別に置き、確定した時に初めて
--   inventory_move(...) で移動記録＋残数が1トランザクションで作られる。差し戻しは残数に触れない。
--
--  ★追加のみDDL（CREATE TABLE / INDEX / POLICY / FUNCTION）。既存には触れない。
--   確認役の設定は settings.inventory_confirm_role（'self' | 'office'・未設定＝self）。
--  ロールバック: drop function inventory_confirm_pending(uuid, uuid, text, text);
--                drop table inventory_pending_moves;
-- ============================================================
create table if not exists public.inventory_pending_moves (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id),
  kind          text not null check (kind in ('in', 'out', 'return')),
  qty           integer not null check (qty > 0),
  site_id       uuid references public.sites(id) on delete set null,
  photo_urls    text[] not null default '{}',
  note          text,
  report_date   date,
  -- 作業員側で出た AI の読み・候補（事務側が確定する時の手がかり。無くてもよい）
  ai_guess_name     text,
  ai_guess_category text,
  ai_candidates     jsonb not null default '[]',      -- [{id,name,unit,category,confidence}]
  -- 作業員が「たぶんこれ」と選んだ品目（事務モードでも選べる。確定時の既定値になるだけで残数には触れない）
  suggested_item_id uuid references public.inventory_items(id) on delete set null,
  created_by_worker_id uuid references public.workers(id) on delete set null,
  created_by_name      text,
  client_request_id    uuid,
  status        text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  item_id       uuid references public.inventory_items(id) on delete set null,   -- 確定した品目
  movement_id   uuid references public.inventory_movements(id) on delete set null, -- 確定で作られた移動記録
  decided_at    timestamptz,
  decided_by_name text,
  reject_reason text,
  created_at    timestamptz not null default now()
);
comment on table public.inventory_pending_moves is
  '在庫③: 確認役＝事務側の会社で、作業員が写真＋数量で送った「品目未確定」の登録。確定で inventory_movements が作られ残数に反映される。差し戻しは残数に触れない';

create index if not exists inventory_pending_moves_account_status_idx
  on public.inventory_pending_moves (account_id, status, created_at desc);
create unique index if not exists inventory_pending_moves_client_request_uidx
  on public.inventory_pending_moves (account_id, client_request_id)
  where client_request_id is not null;

-- RLS/権限（inventory_items / inventory_movements と同型: authenticated のみ・account_id スコープ。EF は service_role）
do $$ declare t text;
begin
  foreach t in array array['inventory_pending_moves'] loop
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

-- 事務側が品目を確定する（または差し戻す）。確定は inventory_move(...) を通す＝移動記録＋残数が1トランザクション。
-- ★security invoker: admin（authenticated＋RLS）から呼ぶと自テナントの行しか見えない＝他社の確認待ちは確定できない。
create or replace function public.inventory_confirm_pending(
  p_pending_id uuid,
  p_item_id    uuid,            -- null なら差し戻し
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

  -- 品目は同じテナントのものだけ（inventory_move の中でも for update で掴む）
  if not exists (select 1 from inventory_items where id = p_item_id and account_id = v_p.account_id and active) then
    raise exception '品目が見つかりません';
  end if;

  -- ★べき等キーに「確認待ちの id」を使う（Gemini 指摘: created_at desc limit 1 は他経路の挿入と競合しうる）。
  --   移動記録は (account_id, client_request_id) で一意なので、いま作った行を確実に引ける。
  v_item := inventory_move(
    p_item_id, case when v_p.kind = 'out' then -v_p.qty else v_p.qty end, v_p.note, v_p.kind, v_p.site_id,
    v_p.photo_urls, v_p.created_by_worker_id, v_p.created_by_name, v_p.report_date, v_p.id
  );
  select id into v_mv_id from inventory_movements
   where account_id = v_p.account_id and client_request_id = v_p.id;
  if v_mv_id is null then
    raise exception '移動記録を作れませんでした';
  end if;
  -- 事務側が確定した印（confirm_status は 20260914150000 で追加済み）
  update inventory_movements set confirm_status = 'confirmed' where id = v_mv_id;

  update inventory_pending_moves
     set status = 'confirmed', item_id = p_item_id, movement_id = v_mv_id,
         decided_at = now(), decided_by_name = nullif(btrim(coalesce(p_decided_by_name, '')), '')
   where id = p_pending_id
   returning * into v_p;
  return v_p;
end;
$$;

grant execute on function public.inventory_confirm_pending(uuid, uuid, text, text) to authenticated, service_role;
revoke execute on function public.inventory_confirm_pending(uuid, uuid, text, text) from anon;
