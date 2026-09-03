-- ============================================================
--  20260903050000_rls_phase2_quick_wins.sql
--  本番DBのRLS有効化 — 第2段の一部（安全に閉じられる3表のみ）
--  Notion: 「c) Phase2: liff露出表のRLS化（身元設計B後）」の一部着手
--
--  ★このmigrationのスコープ（2026-09-03・実測に基づく段階適用）:
--   Phase2チケットは liff露出20表を対象にするが、そのうち LIFF が直接
--   anon で読んでいる表（users/schedules/site_attachments/site_chat_messages 等）は
--   「身元設計B」（LINE ID token検証をPostgREST/RLSレベルで効かせる設計）が
--   要る大きな作業で、誤ると本番liffが全断する。今回はそこに手を付けない。
--
--   一方、本番の実測で以下3表は **LIFFから一切参照されていない**
--   （admin専用 or 既にEF=service_role経由）ことを確認済み：
--     dev_updates … admin/pages/index.vue のみ。LIFFは触らない
--     faq_entries … admin/pages/faq.vue（管理画面のFAQ編集）。
--                    supabase/functions/ai-chat が読むが、このmigrationと
--                    同時に service_role へ切り替える（下記）
--     vehicles    … admin/pages/vehicles.vue（管理画面）。LIFFは
--                    master-data EF(service_role) 経由でのみ参照済み
--                    （直接 anon read は無い＝2026-09-03実測でgrep 0件）
--
--   Phase1（20260801000000）と同じ「admin専用テーブルのRLS化テンプレ」を適用する。
--   残り17表程度（liff直参照分）は別migrationで、身元設計Bが決まってから閉じる。
--
--  ★前提の解消（このmigrationと対で必須）:
--   - ai-chat EF: faq_entries の読み取りを anon クライアント→service_role に変更
--     （Phase1のコメントで「先に直してから閉じる」と明記されていたもの）
--   - scripts/add-dev-update.mjs: 接続キーを anon→service_role に変更
--   どちらもこのコミットで同時に直す（片方だけ流すと本番で機能が黙って壊れる）。
--
--  ※ 追加のみDDLではない（RLS有効化＋anon revoke）。本番適用は人の承認が要る。
--   既存データは一切変更しない＝ロールバックは末尾の手順で完全に戻る。
-- ============================================================

do $$
declare
  t text;
  -- account_id 列を持つ表（テナントスコープのポリシーを張る。Phase1と同型）
  scoped text[] := array['faq_entries', 'vehicles'];
begin
  foreach t in array scoped loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'account_id'
    ) then
      raise exception 'RLS phase2 quick-wins: % に account_id 列が無い（対象表の選定ミス）', t;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format($f$create policy %I on public.%I for select to authenticated
      using (account_id = (select public.current_account_id()))$f$, t || '_sel', t);

    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (account_id = (select public.current_account_id()))$f$, t || '_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (account_id = (select public.current_account_id()))
      with check (account_id = (select public.current_account_id()))$f$, t || '_upd', t);

    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
      using (account_id = (select public.current_account_id()))$f$, t || '_del', t);

    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- dev_updates は account_id を持たない「全テナント共通のお知らせ」表。
-- ★スコープを張らず authenticated 全員に select/update(archived切替)を許す。
--  insert/delete は許さない（本番反映のたびに運用スクリプト=service_roleが積むだけ）。
alter table public.dev_updates enable row level security;

drop policy if exists dev_updates_sel on public.dev_updates;
create policy dev_updates_sel on public.dev_updates for select to authenticated using (true);

drop policy if exists dev_updates_upd on public.dev_updates;
create policy dev_updates_upd on public.dev_updates for update to authenticated using (true) with check (true);

revoke all on public.dev_updates from anon;

-- ── ロールバック手順（本番で問題が出た時はこれを流す）────────────────
--   do $$ declare t text; begin
--     foreach t in array array['faq_entries','vehicles','dev_updates'] loop
--       execute format('alter table public.%I disable row level security', t);
--       execute format('grant all on public.%I to anon', t);
--     end loop;
--   end $$;
