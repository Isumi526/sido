-- 現場ごとの既定休憩を「開始時刻＋休憩時間」の複数登録に対応する。
-- 単一値 default_break_minutes（20260704010000・dev内未ship）を置換する新カラム。
-- 追加のみ・nullable。新規日報で現場選択時に worker entry へ [{start,minutes}] をスナップショットし、
-- breakSnapshot=true の日報のみ人件費計算で開始時刻を料率(深夜/残業)に反映する（過去日報は不変）。
alter table public.sites add column if not exists default_breaks jsonb;

comment on column public.sites.default_breaks is
  '現場既定休憩 [{"start":"12:00","minutes":60},...]。新規日報で worker entry へスナップショット。単一の default_break_minutes(旧)を置換。';
