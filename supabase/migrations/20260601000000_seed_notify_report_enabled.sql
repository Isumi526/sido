-- 日報の送信・編集時 LINE 通知の ON/OFF（key: notify_report_enabled）
-- 未設定アカウントはアプリ/Edge Function 側でON扱い。
-- sido（本番）・test ともに通知OFFにする。
INSERT INTO settings (key, value, label, account_id, updated_at)
SELECT 'notify_report_enabled', 'false', '日報通知（送信・編集）', id, now()
FROM accounts WHERE slug IN ('sido', 'test')
ON CONFLICT (key, account_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
