-- sido（本番）・test アカウントの LINE通知グループID を settings に登録
INSERT INTO settings (key, value, label, account_id, updated_at)
SELECT 'notify_group_id', 'C5431055b8843aa3b752ca1aa2a3e5e80', 'LINE通知グループID', id, now()
FROM accounts WHERE slug = 'sido'
ON CONFLICT (key, account_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO settings (key, value, label, account_id, updated_at)
SELECT 'notify_group_id', 'Cf2d6d3d6f5b326c48ce30c9980c62dae', 'LINE通知グループID', id, now()
FROM accounts WHERE slug = 'test'
ON CONFLICT (key, account_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
