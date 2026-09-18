-- ============================================================
--  20260914130000_pending_edits_notified_at.sql
--  承認依頼メール（申請時に管理者＋現場責任者へ）を送ったことを記録する列。
--  二重送信の防止と「メールが行ったか」の裏取りに使う（overtime_requests.notified_at と同じ役割）。
--  ★追加のみ。
-- ============================================================
alter table public.daily_report_pending_edits
  add column if not exists notified_at timestamptz;

comment on column public.daily_report_pending_edits.notified_at is
  '承認依頼メールを管理者・現場責任者へ送った時刻（送れなかった/OFF の時は NULL）';
