-- ============================================================
--  20260615000000_workers_auth_user_id.sql
--  Phase 2a：作業員の email/password 認証基盤
--   - workers に auth.users への紐付け列 auth_user_id を追加。
--   - email/pw でログインした作業員の auth.users.id をここに保持し、
--     workers ⇔ Supabase Auth ユーザを 1:1 で結ぶ。
--   - LINE(anon) 経路は無改変（users.line_user_id 側）。本列は email/pw 経路専用。
--  追加のみDDL（ADD COLUMN / CREATE INDEX）。破壊的変更なし・後方互換・冪等。
-- ============================================================

do $$
begin
  if to_regclass('public.workers') is not null then
    -- auth.users 参照（Supabase Auth の本体テーブル）。null許容＝未設定の作業員はLINEのみ。
    alter table public.workers
      add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
    create index if not exists workers_auth_user_id_idx on public.workers (auth_user_id);
  end if;
end $$;
