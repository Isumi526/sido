-- ============================================================
--  20260619000000_expense_users_rls.sql
--  expense_users（本番drift表）の anon 露出を塞ぐ（親エピック「本番DBのRLS有効化」①）
--   - 本番のみ存在する committed-migration 外の drift 表で、anon×RLS無効＝
--     公開anonキーで経費ユーザ（line_user_id/real_name/worker_role）が直接読める状態だった。
--   - 現行コードからの参照は admin / liff / Edge いずれも無し（レガシー/孤立表）。
--     よって account 単位ポリシーは付けず「anon 全拒否・service_role(Edge) のみ」で閉じる。
--     ※ account_id 列が無いため purchase_orders 方式の account スコープは適用不可。
--   - local には未存在（drift）のため、本番スキーマに一致させて CREATE（migration整合）。
--     prod では既存のため CREATE はスキップ（IF NOT EXISTS）＝enable RLS / revoke のみ効く。
--  追加のみDDL（CREATE TABLE IF NOT EXISTS / enable RLS / revoke）。破壊的変更なし・後方互換。
--  ロールバック: alter table expense_users disable row level security; grant ... （anon露出に戻す）。
-- ============================================================

create table if not exists expense_users (
  id           uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  real_name    text not null,
  worker_role  text not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- anon 露出を遮断：RLS 有効化＋ポリシー無し（＝anonは全拒否）＋直接権限も剥奪。
-- service_role（Edge）は RLS をバイパスするため、将来 Edge 経由で使う場合も支障なし。
alter table expense_users enable row level security;
revoke all on expense_users from anon;
