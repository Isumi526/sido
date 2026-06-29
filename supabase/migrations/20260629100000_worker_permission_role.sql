-- ============================================================
--  20260629100000_worker_permission_role.sql
--  作業員(ユーザー)に「権限ロール」を導入（土台・チケット 38b0ff81c56b80beb45bd6cca55e85ba）。
--  既存の workers.role / users.worker_role は「勤務区分(factory/site)」で別概念のため
--  混同せず、新規に permission_role 列を追加する（追加のみ・後方互換）。
--   - 管理者(admin) > 事務員(office) > 現場担当者(site_manager) > 職人(worker) の4階層。
--   - 既定 'worker'（最小権限）。
--  ※ 実際の画面/操作ガード（権限マトリクス）と「時間単価の非表示」は後続フェーズ
--    （admin作業員ログイン #3 ＋ 詳細マトリクス確定後）で適用する。本migrationは
--    ロール値の保持のみ＝土台。
--  追加のみDDL（ADD COLUMN）。非破壊。
-- ============================================================
alter table public.workers
  add column if not exists permission_role text not null default 'worker'
    check (permission_role in ('admin', 'office', 'site_manager', 'worker'));

alter table public.users
  add column if not exists permission_role text not null default 'worker'
    check (permission_role in ('admin', 'office', 'site_manager', 'worker'));

comment on column public.workers.permission_role is
  '権限ロール: admin(管理者)>office(事務員)>site_manager(現場担当者)>worker(職人)。勤務区分roleとは別概念。';
comment on column public.users.permission_role is
  'workers.permission_role の同期コピー（ログイン時の権限判定用・後続フェーズで利用）。';
