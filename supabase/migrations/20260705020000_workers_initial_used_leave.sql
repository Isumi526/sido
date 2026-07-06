-- ============================================================
--  20260705020000_workers_initial_used_leave.sql
--  有給の「導入前に既に消化した日数」を登録できるように（有給自動付与のモデルB）。
--   - 移行初期残高(paid_leave_grants)は days>0 の「＋付与」しか登録できず、
--     『既に使った日数（マイナス）』を入れる手段が無かった。本カラムでそれを補う。
--   - 残日数 = 有効付与合計 −（initial_used_leave_days ＋ システム使用(daily_reports leave_type=paid_leave)）。
--   - 導入時に一度登録し、以降はシステム内の有給申請で自動計算（チケットの意図どおり）。
--   追加のみDDL（ADD COLUMN・default 0）。非破壊・後方互換。
-- ============================================================
alter table workers
  add column if not exists initial_used_leave_days numeric(5,1) not null default 0;

comment on column workers.initial_used_leave_days is '導入前に既に消化した有給日数（残日数計算で控除・0.5日単位）。以降の消化は daily_reports(leave_type=paid_leave) で自動計算。';
