-- ============================================================
--  supabase/migrations/20260509900000
--  マルチテナント整理
--  - マスタテーブルの unique(name) → unique(name, account_id)
--  - settings の PK を (key, account_id) に変更
--  - test アカウント作成 + 初期データ投入
-- ============================================================

-- ── 1. マスタテーブルの unique 制約を per-account に変更 ──────

ALTER TABLE workers        DROP CONSTRAINT IF EXISTS workers_name_key;
ALTER TABLE sites          DROP CONSTRAINT IF EXISTS sites_name_key;
ALTER TABLE subcontractors DROP CONSTRAINT IF EXISTS subcontractors_name_key;
ALTER TABLE vehicles       DROP CONSTRAINT IF EXISTS vehicles_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS workers_name_account_uidx        ON workers(name, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS sites_name_account_uidx          ON sites(name, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS subcontractors_name_account_uidx ON subcontractors(name, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_name_account_uidx       ON vehicles(name, account_id);

-- ── 2. settings の PK を (key, account_id) に変更 ─────────────
-- account_id が null のままの行を seed で埋める
UPDATE settings
SET account_id = (SELECT id FROM accounts WHERE slug = 'seed')
WHERE account_id IS NULL;

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE settings ADD PRIMARY KEY (key, account_id);

-- ── 3. test アカウント作成 ────────────────────────────────────

INSERT INTO accounts (name, slug) VALUES ('テストアカウント', 'test')
ON CONFLICT (slug) DO NOTHING;

-- ── 4. settings を test アカウントにコピー ────────────────────

INSERT INTO settings (key, value, label, account_id)
SELECT s.key, s.value, s.label, a.id
FROM settings s
CROSS JOIN (SELECT id FROM accounts WHERE slug = 'test') a
WHERE s.account_id = (SELECT id FROM accounts WHERE slug = 'seed')
ON CONFLICT (key, account_id) DO NOTHING;

-- ── 5. test アカウント用マスタデータ ─────────────────────────

INSERT INTO workers (name, role, unit_price, sort_order, account_id) VALUES
  ('テスト工場A', 'factory', 20000, 1, (SELECT id FROM accounts WHERE slug = 'test')),
  ('テスト工場B', 'factory', 20000, 2, (SELECT id FROM accounts WHERE slug = 'test')),
  ('テスト現場A', 'site',    20000, 3, (SELECT id FROM accounts WHERE slug = 'test')),
  ('テスト現場B', 'site',    20000, 4, (SELECT id FROM accounts WHERE slug = 'test'))
ON CONFLICT DO NOTHING;

INSERT INTO sites (name, sort_order, account_id) VALUES
  ('テスト現場1', 1, (SELECT id FROM accounts WHERE slug = 'test')),
  ('テスト現場2', 2, (SELECT id FROM accounts WHERE slug = 'test'))
ON CONFLICT DO NOTHING;

INSERT INTO subcontractors (name, sort_order, account_id) VALUES
  ('テスト業者', 1, (SELECT id FROM accounts WHERE slug = 'test'))
ON CONFLICT DO NOTHING;

INSERT INTO vehicles (name, sort_order, account_id) VALUES
  ('テスト車両',   1, (SELECT id FROM accounts WHERE slug = 'test')),
  ('ハイエース',   2, (SELECT id FROM accounts WHERE slug = 'test')),
  ('キャラバン',   3, (SELECT id FROM accounts WHERE slug = 'test')),
  ('プロボックス', 4, (SELECT id FROM accounts WHERE slug = 'test'))
ON CONFLICT DO NOTHING;
