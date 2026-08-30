-- ============================================================
--  20260823020000_inventory_mvp.sql
--  在庫管理MVP（Notion: 在庫管理をMVP(最小)で作る）。
--
--  ★スコープ（MVP・推奨A）: 資材/品目を「会社(テナント)単位」で管理する最小形。
--   品目マスタ(inventory_items) と 入出庫記録(inventory_movements)。現在庫は items.current_qty に持ち、
--   入出庫のたびにアプリ側で加減する（MVPはトリガーを置かず素直に。監査は movements 側に残る）。
--   ★将来のテナント間共有は別途（越境になるため共有範囲/権限/RLS設計が要る）。MVPは account_id 論理分離に閉じる。
--
--  ★追加のみDDL（CREATE TABLE / INDEX / POLICY）。既存には触れない。
--   RLS/権限は estimate_supplier_rates 等と同型（authenticated のみ・account_id スコープ）。
-- ============================================================

-- ── 品目マスタ（会社ごと）──────────────────────────────
create table if not exists inventory_items (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id),
  name         text not null,
  unit         text,
  code         text,                       -- 任意の品番/型番
  current_qty  numeric not null default 0, -- 現在庫（入出庫のたびにアプリが加減する）
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table inventory_items is '在庫の品目マスタ（会社単位・MVP）。current_qty は inventory_movements の加減の結果を保持する。';

-- 同一会社で品目名は一意（同名の重複登録を防ぐ）
create unique index if not exists inventory_items_name_uidx on inventory_items(account_id, lower(name));
create index if not exists inventory_items_account_idx on inventory_items(account_id, active);

-- ── 入出庫記録（増減の履歴）────────────────────────────
create table if not exists inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id),
  item_id       uuid not null references inventory_items(id) on delete cascade,
  delta         numeric not null,          -- +入庫 / -出庫
  note          text,
  created_by_name text,
  created_at    timestamptz not null default now()
);
comment on table inventory_movements is '在庫の入出庫記録（+入庫/-出庫）。現在庫の変更根拠を残す。';
create index if not exists inventory_movements_item_idx on inventory_movements(account_id, item_id, created_at desc);

-- ── RLS/権限（authenticated のみ・account_id スコープ）──────
do $$ declare t text;
begin
  foreach t in array array['inventory_items','inventory_movements'] loop
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

-- ── ロールバック手順 ──────────────────────────────────
--   drop table if exists inventory_movements;
--   drop table if exists inventory_items;
