-- ============================================================
--  20260620000000_users_account_worker_unique.sql
--  users(account_id, worker_id) に一意制約を付与（email/pw作業員のusers行 重複対策）
--   - email/pw 作業員の users 行を check-then-insert で作っていたため、同時解決で
--     (account_id, worker_id) が重複した users 行ができる恐れがあった（独立レビュー medium）。
--   - 一意 index を張り、呼び出し側を upsert(onConflict) 化することで重複を構造的に防ぐ。
--   - LINE ユーザは worker_id IS NULL（NULL同士は一意制約上 区別される＝同一accountに複数LINEユーザ可）。
--     よって全体 index でも LINE 側は制約されず、非NULL（email/pw）行だけが実質一意化される。
--  追加のみDDL（CREATE UNIQUE INDEX IF NOT EXISTS）。破壊的変更なし・後方互換。
--  ※ 既存に (account_id, worker_id) 重複行があると作成に失敗する。本番適用前に重複の有無を確認し、
--    あれば人手で重複解消（古い方を削除＝破壊的のためCCは実行しない）してから適用すること。
--  ロールバック: drop index if exists users_account_worker_uniq;
-- ============================================================

create unique index if not exists users_account_worker_uniq
  on users (account_id, worker_id);
