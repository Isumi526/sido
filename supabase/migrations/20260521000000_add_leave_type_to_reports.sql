-- daily_reports に leave_type 列を追加
-- 値: null（通常）| 'paid_leave'（有給）
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS leave_type text;
