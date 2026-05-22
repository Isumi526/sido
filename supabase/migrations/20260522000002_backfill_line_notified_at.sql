-- 既存の通知済み日報に line_notified_at をバックフィル
-- 送信済みであることが確認されている全日報を created_at 時刻で通知済みにする
UPDATE daily_reports
SET line_notified_at = created_at
WHERE line_notified_at IS NULL
  AND account_id = (SELECT id FROM accounts WHERE slug = 'sido');
