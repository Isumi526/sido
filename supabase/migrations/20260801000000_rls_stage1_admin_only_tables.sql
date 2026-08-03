-- ============================================================
--  20260801000000_rls_stage1_admin_only_tables.sql
--  本番DBのRLS有効化 — 第1段（admin専用テーブルのみ）
--  Notion: 本番DBのRLS有効化（公開anonキー前提のデータ保護強化）
--          回答=C（段階適用＋各段ロールバック手順）
--
--  ★背景: anonキーは admin/liff の公開バンドルに同梱＝誰でも view-source で取れる。
--   RLS 無効の表は anonキー1本で全テナントのデータを読み書きできる。
--
--  ★なぜ「admin専用」だけなのか（第1段の線引き・2026-08-01 実コード棚卸し）:
--   LIFF は **LINEアプリ内で開くと authMode='line'＝anon** で動く（useLiff.ts）。
--   LINE は本番で現役（直近30日の日報提出39人中25人がLINE紐付・2人はLINEでしか入れない）。
--   つまり **liff が触る表を authenticated に閉じると本番が即座に壊れる**。
--   そこで第1段は「apps/liff からも apps/gas からも一切参照されない表」だけに限定する。
--   liff露出表（sites/daily_reports/users/schedules/site_chat_* 等）は、
--   liff の身元設計が決まってから第2段以降でまとめて対応する（別チケット
--   「c) Phase2: liff露出表のRLS化（身元設計B後）」）。
--
--  対象8表（apps/admin と service_role の edge function からしか参照されない）:
--    operation_logs             操作ログ（admin/lib/operationLog.ts のみ）
--    worker_wage_history        昇給履歴（admin/pages/workers.vue・index.vue のみ）
--    worker_family_members      家族構成（admin/pages/workers.vue のみ）
--    worker_health_checkups     健診履歴（admin/pages/workers.vue のみ）
--    worker_attachments         作業員の添付（admin ＋ worker-attachment-url EF=service_role）
--    worker_vehicle_inspections 車検履歴（★どこからも参照されない orphan 表）
--    vehicle_repair_logs        車両の修理ログ（admin/pages/vehicles.vue のみ）
--    vehicle_attachments        車両の添付（admin ＋ vehicle-attachment-url EF=service_role）
--
--  ★除外したもの（誤って閉じると壊れるため・記録として残す）:
--    faq_entries … admin専用に見えるが supabase/functions/ai-chat が **anonクライアント**で
--                  select している（JWTを転送していない）。閉じるとAIヘルプのFAQ注入が
--                  **エラーにならず黙って効かなくなる**（rows空で return ''）。
--                  ai-chat を service_role かJWT転送に直してから第2段で閉じる。
--    dev_updates  … scripts/add-dev-update.mjs が anon で INSERT する運用スクリプトがある。
--                  スクリプト側を service_role に寄せてから閉じる。
--
--  方式は purchase_orders と同じ（認証ありテーブルのRLS化テンプレ）:
--    enable RLS ＋ account_id スコープの4ポリシー（to authenticated）＋ revoke anon。
--    public.current_account_id() は JWT app_metadata.account_slug → accounts.id。
--
--  ※ 追加のみDDLではない（RLS有効化＋anon revoke）。本番適用は人の承認が要る。
--   既存データは一切変更しない＝ロールバックは末尾の手順で完全に戻る。
-- ============================================================

do $$
declare
  t text;
  -- account_id 列を持つ表（テナントスコープのポリシーを張る）
  scoped text[] := array[
    'operation_logs', 'worker_wage_history', 'worker_family_members',
    'worker_health_checkups', 'worker_attachments',
    'vehicle_repair_logs', 'vehicle_attachments'
  ];
begin
  foreach t in array scoped loop
    -- account_id 列が無い表を誤って対象にしていたら気づけるように明示的に落とす
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'account_id'
    ) then
      raise exception 'RLS stage1: % に account_id 列が無い（対象表の選定ミス）', t;
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

-- worker_vehicle_inspections は account_id を持たない orphan 表（アプリからの参照ゼロ）。
-- テナントスコープを張れないので「authenticated にも開けない＝deny-all」で閉じる。
-- 復活させる時は account_id を足してから上と同じポリシーにすること。
alter table public.worker_vehicle_inspections enable row level security;
revoke all on public.worker_vehicle_inspections from anon;

-- ── ロールバック手順（本番で問題が出た時はこれを流す）────────────────
--   do $$ declare t text; begin
--     foreach t in array array['operation_logs','worker_wage_history','worker_family_members',
--                              'worker_health_checkups','worker_attachments',
--                              'vehicle_repair_logs','vehicle_attachments',
--                              'worker_vehicle_inspections'] loop
--       execute format('alter table public.%I disable row level security', t);
--       execute format('grant all on public.%I to anon', t);
--     end loop;
--   end $$;
