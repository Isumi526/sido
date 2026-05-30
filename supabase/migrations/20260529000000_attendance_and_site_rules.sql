-- ============================================================
--  supabase/migrations/20260529000000
--  出退勤記録・現場ルール確認機能
-- ============================================================

-- ── 現場ルールマスタ ──────────────────────────────────────────
create table if not exists site_rules (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid references sites(id) on delete cascade,
  timing     text check (timing in ('checkin', 'checkout', 'both')) not null,
  content    text not null,
  is_preset  boolean default false,
  sort_order int default 0,
  created_at timestamptz default now()
);

alter table site_rules disable row level security;

-- ── is_admin ヘルパー関数 ─────────────────────────────────────
-- Supabase Auth で認証済み（管理画面ログイン）ならtrue
create or replace function is_admin(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from auth.users where id = uid
  )
$$;

-- ── 出退勤ログ ────────────────────────────────────────────────
create table if not exists attendance_logs (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid references sites(id),
  worker_id         uuid references workers(id),
  type              text check (type in ('checkin', 'checkout')) not null,
  checked_at        timestamptz default now(),
  agreed_rule_texts text[] not null,
  -- ★ルールのIDではなくテキストを保存（法的証拠要件）
  -- 後からルール内容を編集しても同意時点の内容が変わらないこと
  location_lat      float,
  location_lng      float,
  proxy_worker_id   uuid references workers(id),
  -- 代理操作の場合は操作した作業員IDを記録
  created_at        timestamptz default now()
);

alter table attendance_logs enable row level security;

-- 管理者は全ログ参照可
drop policy if exists "admin_read_all_logs" on attendance_logs;
create policy "admin_read_all_logs"
on attendance_logs for select
using (is_admin(auth.uid()));

-- 作業員は自分のログのみ参照可（将来のJWT認証導入時に有効）
drop policy if exists "workers_read_own_logs" on attendance_logs;
create policy "workers_read_own_logs"
on attendance_logs for select
using (worker_id = auth.uid());

-- INSERTは全員可（LIFFのanonキー・代理操作どちらも）
drop policy if exists "anyone_insert_logs" on attendance_logs;
create policy "anyone_insert_logs"
on attendance_logs for insert
with check (true);

-- UPDATE・DELETEは誰も不可（法的証拠要件）
drop policy if exists "no_update_logs" on attendance_logs;
create policy "no_update_logs"
on attendance_logs for update using (false);

drop policy if exists "no_delete_logs" on attendance_logs;
create policy "no_delete_logs"
on attendance_logs for delete using (false);
