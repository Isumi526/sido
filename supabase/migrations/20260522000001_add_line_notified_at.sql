-- LINE通知済みフラグ
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS line_notified_at timestamptz;
