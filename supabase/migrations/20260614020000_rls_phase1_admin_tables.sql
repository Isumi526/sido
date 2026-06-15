-- ============================================================
--  20260614020000_rls_phase1_admin_tables.sql
--  本番DBのRLS有効化 — Phase 1：admin専用表のanon遮断＋テナントRLS
--   - 対象は「LIFF(anon)が一切触らない admin専用表」だけ（liff露出表は身元設計B/別workstreamで対応）。
--   - REVOKE ALL FROM anon … 公開 anon キー経路（ブラウザ配布）を即遮断＝Phase1の最大の山。
--   - ENABLE RLS ＋ account スコープ … テナント越境読取も同時に塞ぐ。
--   - service_role（edge functions）は RLS バイパス。authenticated（admin・Supabase Auth）のみ自account可。
--  分類根拠: apps/liff 配下の .from()/REST 参照を grep し anon が触らない表を admin専用とした。
--  除外（Phase1で触らない）:
--   - dev_updates … add-dev-update.mjs が anon キーで書込むため revoke で壊れる（要 service_role 化が先）。
--   - expense_users … 本番のみ存在（committed migration 外のdrift）。スキーマ確定後に別途。
--   - liff露出20表＋site_attachments … anon が読むため revoke 不可（身元設計B確定後にまとめてRLS化）。
--  追加のみDDL（REVOKE / ENABLE RLS / CREATE POLICY）。破壊的変更なし・後方互換。
--  current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み（本migrationより前段）。
--  to_regclass ガードで「表が存在する環境にだけ適用」＝local/prod のdriftに対して安全・冪等。
-- ============================================================

do $$
declare
  t text;
  -- account_id 直持ち → テナントスコープ（4ポリシー）
  acct_tables text[] := array[
    'document_access_tokens',
    'estimates',
    'hidden_rule_suggestions',
    'paid_leave_grants',
    'reminder_logs',
    'subcontractor_contacts',
    'subcontractor_invoice_items',
    'subcontractor_invoices'
  ];
begin
  foreach t in array acct_tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip (not present): %', t;
      continue;
    end if;

    -- 公開 anon キー経路を遮断（多層防御の1段目）
    execute format('revoke all on public.%I from anon', t);
    -- RLS 有効化（service_role はバイパス）
    execute format('alter table public.%I enable row level security', t);

    -- authenticated は自 account のみ read/write（冪等に張り替え）
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (account_id = (select public.current_account_id()))', t || '_sel', t);

    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (account_id = (select public.current_account_id()))', t || '_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (account_id = (select public.current_account_id())) with check (account_id = (select public.current_account_id()))', t || '_upd', t);

    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (account_id = (select public.current_account_id()))', t || '_del', t);
  end loop;

  -- グローバル参照系（テナント列なし）: anon 遮断＋authenticated のみ許可。
  --   schedule_group_shares … schedule_groups に account_id が無く現状テナント分割なし。
  --   anon 遮断が主目的。テナント分離は身元設計B（scheduling のマルチテナント化）で対応。
  if to_regclass('public.schedule_group_shares') is not null then
    revoke all on public.schedule_group_shares from anon;
    alter table public.schedule_group_shares enable row level security;
    drop policy if exists schedule_group_shares_authd on public.schedule_group_shares;
    create policy schedule_group_shares_authd on public.schedule_group_shares
      for all to authenticated using (true) with check (true);
  end if;
end $$;
