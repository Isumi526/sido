-- ============================================================
--  20260630000000_sites_default_work_time.sql
--  現場ごとの固定勤務時刻（開始/終了）。日報の作業時間入力の既定＆上限に使う
--  （チケット 38e0ff81c56b816db483e483864ba94e）。
--   - 担当者が現場ごとに開始/終了時刻を設定。日報入力時、その現場の作業時刻は
--     この値を既定表示し、終了時刻はこの「固定終了」を超えて入力できない
--     （残業申請が無い限り＝早退等で下回るのは可）。残業申請フローは別チケット。
--   - 既存の人件費/集計ロジックは不変（入力を縛るだけ＝保存値ベースの計算はそのまま）。
--  追加のみDDL（ADD COLUMN・time型・nullable）。非破壊。
-- ============================================================
alter table public.sites
  add column if not exists default_start_time time,
  add column if not exists default_end_time   time;

comment on column public.sites.default_start_time is '現場の固定開始時刻（日報入力の既定）。null=未設定（従来どおり）。';
comment on column public.sites.default_end_time   is '現場の固定終了時刻（日報入力の上限・残業申請が無い限り超過不可）。null=未設定。';
