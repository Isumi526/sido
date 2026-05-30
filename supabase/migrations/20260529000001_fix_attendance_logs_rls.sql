-- ============================================================
--  supabase/migrations/20260529000001
--  attendance_logs SELECT RLS修正
--  LIFFはanonキー（auth.uid()=null）のため
--  worker_id = auth.uid() のポリシーが機能しない
--  → SELECTは全員許可に変更（INSERT禁止・UPDATE/DELETE禁止は維持）
-- ============================================================

drop policy if exists "admin_read_all_logs"   on attendance_logs;
drop policy if exists "workers_read_own_logs" on attendance_logs;

drop policy if exists "allow_select_logs" on attendance_logs;
create policy "allow_select_logs"
on attendance_logs for select
using (true);
