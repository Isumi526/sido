-- ============================================================
--  20260702000000_sites_responsible_worker.sql
--  現場マスタに「責任者」を追加（チケット 3910ff81c56b81ce9407ea7491ac4417）。
--   - 現場ごとの責任者＝現場管理者以上(permission_role in admin/office/site_manager)の worker。
--   - 残業申請の通知先（該当現場の責任者にメール）等に使う（#5 が依存）。
--   - 必須化は UI で担保（既存現場は null=UI上「責任者 要登録」表示）。DBは追加のみ・nullable。
--   - 追加のみDDL（ADD COLUMN nullable + INDEX）。非破壊・後方互換。
-- ============================================================
alter table public.sites
  add column if not exists responsible_worker_id uuid references public.workers(id);

comment on column public.sites.responsible_worker_id is
  '現場責任者（現場管理者以上のworker.id）。必須はUIで担保（既存現場はnull=要登録表示）。残業通知の宛先等に使用。';

create index if not exists sites_responsible_worker_idx
  on public.sites (account_id, responsible_worker_id);
