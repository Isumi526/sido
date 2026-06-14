-- ============================================================
--  20260614010000_purchase_orders_rls.sql
--  purchase_orders を テナント(account)スコープの RLS で閉じる。
--   - sido の購買データ経路は authenticated(admin・Supabase Auth) と service_role(edge) のみ。
--     liff/anon は purchase_orders を一切触らないため、anon は全拒否でよい。
--   - authenticated は JWT app_metadata.account_slug → accounts.id に一致する行だけ read/write。
--   - service_role は RLS をバイパス（edge functions 無影響）。
--  ⚠️ 権限変更。本番適用は /ship で人間承認のうえ実施（追加のみDDL=データ非破壊）。
--  前提: 全 admin auth ユーザーの app_metadata.account_slug が設定済みであること
--        （未設定だと current_account_id()=null で締め出される）。E2E は global-setup で付与。
-- ============================================================

-- JWT の app_metadata.account_slug から account_id を解決（STABLE / security definer）
create or replace function public.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from accounts
  where slug = (auth.jwt() -> 'app_metadata' ->> 'account_slug')
  limit 1
$$;

alter table purchase_orders enable row level security;

-- authenticated は自 account のみ
create policy po_sel on purchase_orders for select to authenticated
  using (account_id = (select public.current_account_id()));
create policy po_ins on purchase_orders for insert to authenticated
  with check (account_id = (select public.current_account_id()));
create policy po_upd on purchase_orders for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));
create policy po_del on purchase_orders for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- anon は purchase_orders を使わない → ポリシー無し＝RLSで全拒否。多層防御で直接権限も剥奪。
revoke all on purchase_orders from anon;
