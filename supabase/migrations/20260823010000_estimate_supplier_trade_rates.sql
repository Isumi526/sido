-- ============================================================
--  20260823010000_estimate_supplier_trade_rates.sql
--  掛率を「商社 × 材料区分」で持てるようにする（Notion: 掛率を商社×材料区分で登録・計算）。
--
--  ★背景: これまで掛率は estimate_supplier_rates で「商社ごと一律1レート」だけだった。
--   実務では同じ商社でも材料区分（床材・クロス・ボード…）で掛率が違う（森松: 床材0.42 / クロス0.40）。
--   材料区分は既存の「工種」(estimate_trades) を流用する（estimate_materials.trade_id が既にあり、
--   新しい区分マスタを作らない＝品番の再区分が不要で最も可逆。将来 独立した材料区分が必要なら
--   区分マスタ＋列を足せる。これも追加のみで可能）。
--
--  ★計算の優先順位（estimate-builder の purchaseUnitPrice）:
--     ①単価表の絶対額(unit_price) ＞ ②品番×商社の上書き(estimate_material_prices.rate)
--     ＞ ③商社×工種(このテーブル) ＞ ④商社一律(estimate_supplier_rates)。該当が無ければ下位にフォールバック。
--
--  ★追加のみDDL（CREATE TABLE / INDEX / POLICY）。既存の列・データには触れない。
--   RLS/権限は estimate_supplier_rates と同型（authenticated のみ・account_id スコープ）。
-- ============================================================

create table if not exists estimate_supplier_trade_rates (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id),
  supplier_id   uuid not null references subcontractors(id) on delete cascade,
  trade_id      uuid not null references estimate_trades(id) on delete cascade,
  rate          numeric not null,      -- 0.42 = 定価の42%で仕入れる
  note          text,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table estimate_supplier_trade_rates is
  '商社×材料区分（＝工種 estimate_trades）ごとの仕入掛率。商社一律(estimate_supplier_rates)より優先し、'
  ' 品番個別の上書き(estimate_material_prices.rate)がある時はそちらが優先される。';

-- 同一会社・同一商社・同一工種で1レート
create unique index if not exists est_sup_trade_rate_uidx
  on estimate_supplier_trade_rates(account_id, supplier_id, trade_id);

alter table estimate_supplier_trade_rates enable row level security;
revoke all on estimate_supplier_trade_rates from anon;
grant select, insert, update, delete on estimate_supplier_trade_rates to authenticated;

drop policy if exists est_sup_trade_rate_sel on estimate_supplier_trade_rates;
create policy est_sup_trade_rate_sel on estimate_supplier_trade_rates for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_sup_trade_rate_ins on estimate_supplier_trade_rates;
create policy est_sup_trade_rate_ins on estimate_supplier_trade_rates for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_sup_trade_rate_upd on estimate_supplier_trade_rates;
create policy est_sup_trade_rate_upd on estimate_supplier_trade_rates for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_sup_trade_rate_del on estimate_supplier_trade_rates;
create policy est_sup_trade_rate_del on estimate_supplier_trade_rates for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- ── ロールバック手順 ──────────────────────────────────
--   drop table if exists estimate_supplier_trade_rates;
