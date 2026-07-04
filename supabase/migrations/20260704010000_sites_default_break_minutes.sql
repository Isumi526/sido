-- ============================================================
--  20260704010000_sites_default_break_minutes.sql
--  各現場に「既定の休憩時間（分）」を持たせ、新規日報でその現場を選んだ時に
--  休憩をこの値でスナップショット保存できるようにする（現場固定時刻 default_start/end_time と同型）。
--   - 回答A-1: 現場休憩を「新規日報のみ」人件費に反映し、過去日報の給与は一切変えない。
--   - 過去不変の担保はアプリ側の breakSnapshot フラグ（保存値を尊重するのは snapshot 済みの新規日報だけ）。
--     この migration はデータ列の追加のみ。既存の人件費/集計ロジックには影響しない。
--  追加のみDDL（ADD COLUMN nullable）・非破壊・後方互換。
-- ============================================================
alter table public.sites
  add column if not exists default_break_minutes integer;

comment on column public.sites.default_break_minutes is
  '現場の既定休憩時間（分）。新規日報でこの現場を選ぶと休憩の既定値になり、保存時に breakMinutes をこの値でスナップショット（人件費計算に反映）。null=未設定（従来どおり役割×勤務時間の自動計算）。過去日報は不変。';
