-- ============================================================
--  supabase/migrations/20260730000000
--  見積R41: 定価＋商社別掛率で仕入単価を出す ／ R42: 最安値の比較土台
--
--  議事録『打ち合わせ@260722シードオフィス』§2.3 資材価格管理の複雑性:
--    「定価は統一されているが仕入価格は商社により異なる」
--    「掛率は商社により0.4掛け〜0.45掛け」
--
--  ★語義の注意（重要）
--   既存の「掛け率」＝**粗利率**（原価 ÷ (1−率) で客先単価を出す・accounts.default_margin_rate）で、
--   議事録の「掛率」＝**商社から仕入れる時の掛け率**。まったく別物。
--   Notionに「会社ごと掛け率…完了」チケットがあるため要望が満たされたと誤読される状態だった。
--   ここで入れるのは後者（仕入側）。
--
--  ★構造
--   定価は品番ごとに1つ（商社によらず統一）→ estimate_list_prices
--   掛率は商社ごと（品番×商社で上書きも可）→ estimate_supplier_rates / estimate_material_prices.rate
--   仕入単価 = 定価 × 掛率。ただし絶対額(unit_price)が入っていればそれを優先する
--   （価格表OCRでは絶対額しか取れないことがあり、既存データもすべて絶対額）。
--
--  Notion: R41 / R42
--  追加のみDDL（後方互換・既存の商社単価は絶対額のまま動く）
-- ============================================================

-- ── 定価マスタ（品番ごとに1つ）──
create table if not exists estimate_list_prices (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id),
  product_code text not null,
  item_name    text,
  unit         text,
  maker        text,
  list_price   numeric not null,
  note         text,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
-- 品番は定価の同一性の核なので、アカウント内で一意にする（二重登録＝どちらが正か分からない状態を作らない）
create unique index if not exists est_list_price_code_uidx on estimate_list_prices(account_id, product_code);

alter table estimate_list_prices enable row level security;
revoke all on estimate_list_prices from anon;
grant select, insert, update, delete on estimate_list_prices to authenticated;
drop policy if exists est_list_price_sel on estimate_list_prices;
create policy est_list_price_sel on estimate_list_prices for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_list_price_ins on estimate_list_prices;
create policy est_list_price_ins on estimate_list_prices for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_list_price_upd on estimate_list_prices;
create policy est_list_price_upd on estimate_list_prices for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_list_price_del on estimate_list_prices;
create policy est_list_price_del on estimate_list_prices for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- ── 商社ごとの既定掛率 ──
--  subcontractors に列を足さないのは、あのテーブルが商社・業者・職人を兼ねる
--  共有マスタで、見積固有の値を混ぜると他機能に波及するため。
create table if not exists estimate_supplier_rates (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id),
  supplier_id   uuid not null references subcontractors(id) on delete cascade,
  rate          numeric not null,      -- 0.40 = 4割掛け（定価の40%で仕入れる）
  note          text,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create unique index if not exists est_sup_rate_uidx on estimate_supplier_rates(account_id, supplier_id);

alter table estimate_supplier_rates enable row level security;
revoke all on estimate_supplier_rates from anon;
grant select, insert, update, delete on estimate_supplier_rates to authenticated;
drop policy if exists est_sup_rate_sel on estimate_supplier_rates;
create policy est_sup_rate_sel on estimate_supplier_rates for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_sup_rate_ins on estimate_supplier_rates;
create policy est_sup_rate_ins on estimate_supplier_rates for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_sup_rate_upd on estimate_supplier_rates;
create policy est_sup_rate_upd on estimate_supplier_rates for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_sup_rate_del on estimate_supplier_rates;
create policy est_sup_rate_del on estimate_supplier_rates for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- ── 品番×商社での掛率の上書き ──
--  「この商社はこの品番だけ特別に安い」が実務で起きるため。null = 商社の既定掛率を使う。
alter table estimate_material_prices add column if not exists rate numeric;

-- ★unit_price（絶対額）は not null のまま残す。既存データはすべて絶対額で、
--   定価×掛率へ移行するのは段階的に行う（両方が並存できる形にしておく）。
comment on column estimate_material_prices.rate is
  '定価に対する掛率。unit_price(絶対額)が入っていればそちらを優先する（R41）';
