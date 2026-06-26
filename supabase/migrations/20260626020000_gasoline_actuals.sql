-- ============================================================
--  20260626020000_gasoline_actuals.sql
--  現場経費（ガソリン）見込み→実績の按分（第1版・admin月次入力→距離比配賦）。
--   - gasoline_actuals: その月のガソリン実費合計（領収書ベース）を account×年月で1件保持。
--     admin がガソリン按分画面で入力し、各現場の当月走行距離比で実績配賦する。
--   - 見込み（distanceKm×単価）は既存どおり並走表示し、差異（実績−見込み）を出す。
--   - 回答『実費はLIFF経費申請で添付』は将来のソース連携（第2版）。第1版は admin 月次入力で自己完結。
--  追加のみDDL（CREATE TABLE / unique index / POLICY）。破壊的変更なし。
--  ※ current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み。
-- ============================================================

create table if not exists public.gasoline_actuals (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) not null,
  year_month  text not null,                         -- 'YYYY-MM'
  total_yen   numeric not null default 0,            -- その月のガソリン実費合計（領収書）
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create unique index if not exists gasoline_actuals_account_month_unique
  on public.gasoline_actuals (account_id, year_month);

alter table public.gasoline_actuals enable row level security;
create policy ga_sel on public.gasoline_actuals for select to authenticated
  using (account_id = (select public.current_account_id()));
create policy ga_ins on public.gasoline_actuals for insert to authenticated
  with check (account_id = (select public.current_account_id()));
create policy ga_upd on public.gasoline_actuals for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));
revoke all on public.gasoline_actuals from anon;
