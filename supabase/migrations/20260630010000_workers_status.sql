-- 作業員のライフサイクル状態（有効/退職済み/無効）。
--   既存の active(boolean) は壊さず status='active' の派生として維持する（10+ の active=true フィルタを変えないため）。
--   有効(active)=新規日報・通知の対象 / 退職済み(retired)=記録保持・新規対象外 / 無効(inactive)=ソフト削除（物理削除候補）。
alter table public.workers
  add column if not exists status text not null default 'active'
  check (status in ('active', 'retired', 'inactive'));

-- 既存データの初期化（新列のみのバックフィル・非破壊）: active=false の作業員は '無効'(inactive) として扱う。
update public.workers set status = 'inactive' where active = false and status = 'active';

create index if not exists workers_status_idx on public.workers (account_id, status);
