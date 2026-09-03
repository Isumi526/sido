-- ============================================================
--  20260903100000_site_owner_rls.sql
--  「現場管理者の所有権モデル」Step1: sites テーブルのRLS
--
--  ★背景: 2026-07-31 ユーザー方針「現場管理者の場合、自分が責任者の現場は
--   オーナー同様...閲覧と編集可能、他の現場は詳細の閲覧のみで編集不可」。
--   Q1〜Q4は全て回答済み（Notionチケット参照）。UIだけでは「他人の現場は
--   編集不可」を担保できない（anon/authenticatedキーでAPIを直接叩けば書き換え
--   られる）ため、RLSで担保する。
--
--  ★スコープ: 今回は sites テーブルの UPDATE のみを制限する。
--   - SELECT は変えない（Q3で「閲覧は許可」と確定済み。全消費箇所
--     （dashboards/estimates/gasoline-allocation/process/purchase-orders/
--     report-site-relink/worker-reports 等）がテナント全体のsites読取に
--     依存しており、閲覧を絞る変更ではないため影響なし）。
--   - INSERT は変えない（現場の新規作成自体を制限する決定はされていない。
--     Q1〜Q4は既存データの編集可否についてのみ）。
--   - DELETE は元々使っていない（無効化は active=false の UPDATE。ポリシー
--     を作らないため authenticated からの DELETE は引き続き不可）。
--
--  ★4画面（日報一覧・日報編集承認・残業承認・現場別集計）の絞り込みと、
--   見積書3箇所の「自分の現場なら見える」への緩和、閲覧専用の編集ボタン
--   無効化は、blast radiusが大きい（daily_reports等の既存SELECTポリシーを
--   触るとowner/admin/officeの閲覧まで壊しかねない）ため別migrationに分ける。
--   Notionチケットの「進捗」に継続タスクとして明記済み。
--
--  ★追加のみ。sites.SELECT/INSERTの既存挙動・他テーブルは一切触らない。
-- ============================================================

-- 呼び出し元の workers.id を返す（LINE作業員はSupabase JWTを持たないため
-- authenticated専用。current_account_id() と同じ形）。
create or replace function public.current_worker_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from workers
  where auth_user_id = auth.uid()
    and account_id = public.current_account_id()
  limit 1
$$;

-- 呼び出し元の権限ロールを、apps/admin/src/lib/auth.ts の resolveRole /
-- supabase/functions/_shared/caller-identity.ts の resolveApprover と
-- 同じ規則で解決する（workers行があればpermission_role・無ければ
-- owner_auth_user_id一致のみを'owner'とみなす・フェイルセーフで'worker'）。
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select w.permission_role from workers w
     where w.auth_user_id = auth.uid() and w.account_id = public.current_account_id()),
    (select 'owner' from accounts a
     where a.id = public.current_account_id() and a.owner_auth_user_id = auth.uid()),
    'worker'
  )
$$;

-- 現場の「自分が責任者、またはオーナー/経営系ロール」判定
create or replace function public.can_edit_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from sites s
    where s.id = p_site_id
      and s.account_id = public.current_account_id()
      and (
        public.current_role() in ('owner', 'admin', 'office')
        or (public.current_role() = 'site_manager' and s.responsible_worker_id = public.current_worker_id())
      )
  )
$$;

alter table public.sites enable row level security;
revoke all on public.sites from anon;

-- ★RLSを有効化すると、ポリシーが無いコマンドは全ロールで即座に不許可になる。
--  SELECT/INSERTは「変えない」の実現に明示ポリシーが必須（無いと dashboards/
--  estimates/gasoline-allocation 等の既存の読取・sites.vue の新規作成が
--  全滅する）。UPDATEだけ所有権スコープを追加する。DELETEは既存も使っていない
--  ためポリシーを作らず引き続き不可のまま。
drop policy if exists sites_sel on public.sites;
create policy sites_sel
  on public.sites for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists sites_ins on public.sites;
create policy sites_ins
  on public.sites for insert to authenticated
  with check (account_id = (select public.current_account_id()));

drop policy if exists sites_upd_owner_scope on public.sites;
create policy sites_upd_owner_scope
  on public.sites for update to authenticated
  using (public.can_edit_site(id))
  with check (public.can_edit_site(id));

comment on function public.can_edit_site(uuid) is
  '現場管理者の所有権モデル（2026-07-31方針・Q1〜Q4確定）: owner/admin/officeは常に編集可、'
  ' site_managerは自分が責任者(sites.responsible_worker_id)の現場のみ編集可。'
  ' 責任者未設定/退職済みの現場はsite_managerからは編集不可のままowner/admin/officeが編集する（Q4）。';

-- ────────────────────────────────────────────────────────
--  ★ついでに発見した既存漏れの修正（今回のRLS監査で判明・別チケットの積み残し）:
--   log_purges（20260903070000_log_retention_purge.sql で新設）にRLSを
--   付け忘れており、anonに全テーブル読取が開いていた。どの画面からも読まない
--   （purge_old_logs()がservice_role経由=pg_cronで書くだけの内部監査表）ため、
--   ポリシーを一切作らずRLSだけ有効化して deny-all にする。
-- ────────────────────────────────────────────────────────
alter table public.log_purges enable row level security;
revoke all on public.log_purges from anon;
revoke all on public.log_purges from authenticated;
