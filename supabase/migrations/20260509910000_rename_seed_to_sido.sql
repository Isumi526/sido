-- accounts.slug をリネーム（アカウント初期設定用）
UPDATE accounts SET slug = 'sample-construction' WHERE slug = 'seed';
