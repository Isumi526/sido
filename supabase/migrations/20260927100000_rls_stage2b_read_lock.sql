-- ============================================================
--  20260927100000_rls_stage2b_read_lock.sql
--  RLS第2段B: 公開キー（anon）の「読み」も閉じ、ログインユーザーは自社の行だけにする。
--  （第2段A＝anon の書き込み剥奪は 20260923120000・2026-09-26 本番適用済み）
--
--  ★なぜ必要か（2026-09-26 本番実測）:
--   公開の anon キー（admin/liff のバンドルに入っていて誰でも取得できる）で本番 REST を叩くと
--   users・subcontractors など 29 表が GET 200 で読めた。Supabase の Critical 警告
--   （rls_disabled_in_public）もこの状態を指している。
--   さらに authenticated（ログインユーザー）は RLS が無いので**他社の行も読めた**（rls-audit の XTENANT 許容 26）。
--
--  ★やること（26表）:
--   ・RLS を有効化
--   ・authenticated に「自社の行だけ」の select/insert/update/delete ポリシー
--       account_id 列がある表 … account_id = current_account_id()
--       無い表 … 親の表（現場・予定・グループ・ユーザー）をたどって判定（データは変えない）
--       accounts … 自社の行だけ（id = current_account_id()）。作成・削除は service_role（EF）のみ
--   ・anon の SELECT を剥がす（書き込みは第2段Aで剥奪済み）
--   ・service_role（Edge Function）は RLS をバイパスするので影響なし
--
--  ★安全性の根拠:
--   - 本番の auth.users 50人は全員 provider=email＝作業員アプリ・管理画面はログイン後に動く（JWT に account_slug）
--   - 公開リンク（下請けポータル p/[token]・ゲスト招待 chat-invite/[token]）は EF（service_role）経由
--   - current_account_id() は JWT の app_metadata.account_slug から引く（security definer・既存）
--
--  ロールバック: 末尾の巻き戻しブロック。データ変更はゼロ。
-- ============================================================

-- ── account_id 列を持つ表（20）──────────────────────────────
do $$
declare
  t text;
  tables text[] := array[
    'contractors', 'expense_settlements', 'report_edit_grants', 'schedule_categories',
    'schedule_notifications', 'schedules', 'settings', 'site_attachments',
    'site_chat_last_read', 'site_chat_mentions', 'site_chat_messages', 'site_shares',
    'site_subcontractors', 'subcontractor_comments', 'subcontractor_trade_types', 'subcontractors',
    'trade_type_presets', 'users', 'worker_proxies', 'workers'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_acct_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (account_id = (select public.current_account_id()))', t || '_acct_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_acct_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (account_id = (select public.current_account_id()))', t || '_acct_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_acct_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (account_id = (select public.current_account_id())) with check (account_id = (select public.current_account_id()))', t || '_acct_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_acct_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (account_id = (select public.current_account_id()))', t || '_acct_del', t);
    execute format('revoke select on table public.%I from anon', t);
  end loop;
end $$;

-- ── account_id 列の無い表（6）: 親の表をたどって自社かを判定する（列の追加・データの埋め戻しはしない）──
--  ★親の表にも RLS が掛かっている（sites / schedules / workers / users）ので、サブクエリは「自社の親」しか見えない。
--   ここでも account_id を明示して二重に絞る（親側のポリシーだけに頼らない）。

-- accounts: 自社の行だけ読める。作成・更新・削除は service_role（EF・運用）だけ
alter table public.accounts enable row level security;
drop policy if exists accounts_own_sel on public.accounts;
create policy accounts_own_sel on public.accounts for select to authenticated
  using (id = (select public.current_account_id()));
revoke select on table public.accounts from anon;

-- site_rules: 現場（sites）の会社
alter table public.site_rules enable row level security;
drop policy if exists site_rules_acct_all on public.site_rules;
create policy site_rules_acct_all on public.site_rules for all to authenticated
  using (exists (select 1 from public.sites s where s.id = site_rules.site_id and s.account_id = (select public.current_account_id())))
  with check (exists (select 1 from public.sites s where s.id = site_rules.site_id and s.account_id = (select public.current_account_id())));
revoke select on table public.site_rules from anon;

-- schedule_edits: 予定（schedules）の会社。★既存の allow_all_authenticated（全社の authenticated に全部許可）を置き換える
alter table public.schedule_edits enable row level security;
drop policy if exists allow_all_authenticated on public.schedule_edits;
drop policy if exists schedule_edits_acct_all on public.schedule_edits;
create policy schedule_edits_acct_all on public.schedule_edits for all to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_edits.schedule_id and s.account_id = (select public.current_account_id())))
  with check (exists (select 1 from public.schedules s where s.id = schedule_edits.schedule_id and s.account_id = (select public.current_account_id())));
revoke select on table public.schedule_edits from anon;

-- schedule_groups: 作った作業員（created_by → workers）の会社
alter table public.schedule_groups enable row level security;
drop policy if exists schedule_groups_acct_all on public.schedule_groups;
create policy schedule_groups_acct_all on public.schedule_groups for all to authenticated
  using (exists (select 1 from public.workers w where w.id = schedule_groups.created_by and w.account_id = (select public.current_account_id())))
  with check (exists (select 1 from public.workers w where w.id = schedule_groups.created_by and w.account_id = (select public.current_account_id())));
revoke select on table public.schedule_groups from anon;

-- schedule_group_members: グループの会社。追加する時はメンバーも自社の作業員であること
alter table public.schedule_group_members enable row level security;
drop policy if exists schedule_group_members_acct_all on public.schedule_group_members;
create policy schedule_group_members_acct_all on public.schedule_group_members for all to authenticated
  using (exists (
    select 1 from public.schedule_groups g join public.workers w on w.id = g.created_by
    where g.id = schedule_group_members.group_id and w.account_id = (select public.current_account_id())))
  with check (
    exists (
      select 1 from public.schedule_groups g join public.workers w on w.id = g.created_by
      where g.id = schedule_group_members.group_id and w.account_id = (select public.current_account_id()))
    and exists (
      select 1 from public.workers m
      where m.id = schedule_group_members.worker_id and m.account_id = (select public.current_account_id())));
revoke select on table public.schedule_group_members from anon;

-- expense_items: ユーザー（users）の会社（2026-09 時点でクライアントからは使われていない旧表・本番0行）
alter table public.expense_items enable row level security;
drop policy if exists expense_items_acct_all on public.expense_items;
create policy expense_items_acct_all on public.expense_items for all to authenticated
  using (exists (select 1 from public.users u where u.id = expense_items.user_id and u.account_id = (select public.current_account_id())))
  with check (exists (select 1 from public.users u where u.id = expense_items.user_id and u.account_id = (select public.current_account_id())));
revoke select on table public.expense_items from anon;

-- ============================================================
--  検証（適用後）
--    select tablename from pg_tables where schemaname='public' and not rowsecurity;   -- 26表が消えていること
--    select count(*) from information_schema.role_table_grants
--     where grantee='anon' and table_schema='public' and privilege_type='SELECT'
--       and table_name in (<26表>);                                                   -- 0
--    node scripts/rls-audit.mjs --assert                                              -- 許容リストを減らしても pass
-- ============================================================

-- ============================================================
--  ↩ ロールバック（本番で問題が出たらこれを流す・データ変更はゼロ）
--   1) 26表の RLS を外す:
--      do $$ declare t text; begin foreach t in array array['accounts','contractors','expense_items',
--        'expense_settlements','report_edit_grants','schedule_categories','schedule_edits','schedule_group_members',
--        'schedule_groups','schedule_notifications','schedules','settings','site_attachments','site_chat_last_read',
--        'site_chat_mentions','site_chat_messages','site_rules','site_shares','site_subcontractors',
--        'subcontractor_comments','subcontractor_trade_types','subcontractors','trade_type_presets','users',
--        'worker_proxies','workers'] loop execute format('alter table public.%I disable row level security', t); end loop; end $$;
--   2) anon の SELECT を戻す（本番の付与を写した seed から生成＝列単位も正しく出る）:
--      node scripts/anon-grant-check.mjs --repair（適用前の main の seed.sql で）
--   3) schedule_edits の旧ポリシー:
--      create policy allow_all_authenticated on public.schedule_edits for all to authenticated using (true) with check (true);
--  ポリシー自体は RLS を外せば効かないので、残っていても害はない。
-- ============================================================
