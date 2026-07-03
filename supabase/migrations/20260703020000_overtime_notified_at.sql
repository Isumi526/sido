-- ============================================================
--  20260703020000_overtime_notified_at.sql
--  残業申請の責任者メール通知のべき等性用に notified_at を追加。
--   - notify-overtime EF が送信後に notified_at=now() を記録し、
--     連打/再送で同じ申請に重複メールを送らないようにする（Gemini指摘）。
--  追加のみDDL（ADD COLUMN nullable）・非破壊・後方互換。
-- ============================================================
alter table public.overtime_requests
  add column if not exists notified_at timestamptz;

comment on column public.overtime_requests.notified_at is
  '責任者へメール通知した時刻。notify-overtime EF が送信後に記録し、重複通知を防ぐ（べき等）。';
