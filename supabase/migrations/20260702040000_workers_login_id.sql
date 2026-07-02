-- ============================================================
--  20260702040000_workers_login_id.sql
--  メール無し作業員の ID/PASS ログイン用に workers.login_id を追加（#作業員ID/PASS認証）。
--   - 作業員は「login_id（短い半角英数）」＋パスワードでログインできる（メール不要）。
--   - 実体は worker-auth-setup が `<login_id>@worker.sido-liff.app` のダミーemailを合成して
--     Supabase Auth を作成/更新する（Auth の email はシステム全体で一意）。ログイン画面は
--     テナントを判別できないため login_id は **グローバル一意**（＝ダミーemailも一意）。
--   - 現場管理者以上は通知受信のため実emailを使う（従来どおり email 認証）。
--   - RLS は既存の workers と同じく無効（マスタ層のRLS化は親エピックで一括）。
--   追加のみDDL（ADD COLUMN / partial UNIQUE INDEX）。非破壊・後方互換。
-- ============================================================
alter table public.workers
  add column if not exists login_id text;

-- login_id はグローバル一意（テナント跨ぎで重複不可＝ダミーemailの一意性を担保）。null は許容（メール認証/未設定作業員）。
create unique index if not exists workers_login_id_uidx
  on public.workers (login_id) where login_id is not null;

comment on column public.workers.login_id is
  'メール無し作業員のログインID（短い半角英数・グローバル一意）。worker-auth-setup が <login_id>@worker.sido-liff.app のダミーemailに変換してAuth作成。';
