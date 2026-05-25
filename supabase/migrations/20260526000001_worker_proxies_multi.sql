-- ============================================================
--  worker_proxies テーブル
--  1人の作業員に複数の代理人を設定できるよう中間テーブル化
--  （旧: workers.proxy_operator_id 単一カラム）
-- ============================================================

-- 1. 中間テーブル作成
CREATE TABLE IF NOT EXISTS worker_proxies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id         uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  proxy_operator_id uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(worker_id, proxy_operator_id)
);

-- 2. 既存データを移行
INSERT INTO worker_proxies (worker_id, proxy_operator_id, account_id)
SELECT w.id, w.proxy_operator_id, w.account_id
FROM workers w
WHERE w.proxy_operator_id IS NOT NULL
ON CONFLICT (worker_id, proxy_operator_id) DO NOTHING;

-- 3. 旧カラムを削除
ALTER TABLE workers DROP COLUMN IF EXISTS proxy_operator_id;
