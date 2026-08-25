-- ============================================================
--  20260825010000_pending_edit_paid_leave_over_kind.sql
--  日報の承認保留(daily_report_pending_edits)の kind に 'paid_leave_over' を追加する。
--  Notion: 有給残不足で有給を選んだ新規日報を二重承認制にする（有給A）。
--
--  ★CHECK 制約の「許可値を増やす」変更＝非破壊的（既存行 edit/late_new はそのまま有効）。
--   既存データの削除・変更は一切しない。ロールバックも旧CHECKに戻すだけ。
-- ============================================================

alter table public.daily_report_pending_edits drop constraint if exists drpe_kind_chk;
alter table public.daily_report_pending_edits
  add constraint drpe_kind_chk check (kind = any (array['edit'::text, 'late_new'::text, 'paid_leave_over'::text]));

-- ── ロールバック手順 ──────────────────────────────────
--   alter table public.daily_report_pending_edits drop constraint if exists drpe_kind_chk;
--   alter table public.daily_report_pending_edits
--     add constraint drpe_kind_chk check (kind = any (array['edit'::text, 'late_new'::text]));
