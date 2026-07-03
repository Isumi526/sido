-- ============================================================
--  20260702010000_overtime_requests_sites.sql
--  残業申請に「対象現場」を持たせる（チケット 3910ff81c56b81129562e6514ad85ca2 / #5）。
--   - 申請時に該当現場を複数選択でき、その現場の責任者(sites.responsible_worker_id)へメール通知する。
--   - 現場は名称の配列で保持（daily_reports.sites と同じく現場名ベース・複数可）。site_id配列でも良いが
--     既存の現場参照が名称ベースのため名称配列で統一（マージ時は #7 の doMerge が daily_reports 同様に寄せる対象に将来含める）。
--   - 追加のみDDL（ADD COLUMN・text[]・nullable）。非破壊・後方互換。
-- ============================================================
alter table public.overtime_requests
  add column if not exists site_names text[];

comment on column public.overtime_requests.site_names is
  '残業対象の現場名（複数可）。申請時に選択し、各現場の責任者へメール通知する（#5）。';
