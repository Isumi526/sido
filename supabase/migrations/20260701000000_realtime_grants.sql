-- ============================================================
--  20260701000000_realtime_grants.sql
--  許可申請/残業申請の「承認」を作業員アプリへ即時反映するため、
--  report_edit_grants / overtime_requests を Supabase Realtime 配信対象にする。
--    - worker_id（非PK列）でフィルタ購読するため REPLICA IDENTITY FULL を付与。
--    - 追加のみ（publication 追加・replica identity 変更）＝非破壊。
--    - LIFF(webview) はwebsocketが不安定なことがあるためクライアント側はポーリング併用。
-- ============================================================

alter table public.report_edit_grants replica identity full;
alter table public.overtime_requests   replica identity full;

-- supabase_realtime publication へ追加（既に入っていれば二重追加にならないよう DO ブロックで判定）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'report_edit_grants'
  ) then
    alter publication supabase_realtime add table public.report_edit_grants;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overtime_requests'
  ) then
    alter publication supabase_realtime add table public.overtime_requests;
  end if;
end $$;
