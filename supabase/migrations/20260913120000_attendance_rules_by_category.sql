-- ============================================================
--  20260913120000_attendance_rules_by_category.sql
--  出退勤の確認ルールを作業区分（現場／工場／オフィス…）ごとに持てるようにする（追加のみDDL）
--
--  2026-09-13 亥角: 出退勤を1日ごとにして確認ルールを会社共通にした（2026-08-27）が、
--  現場と工場では基礎のルールが全く違って一元化できない。区分ごとに最低限ルールを分け、
--  打刻時に区分を選んでそのルールに同意する。
--  ★決定: 新しい「出勤区分」は作らず作業区分（work_categories）を流用する
--   （作業員が打刻と日報で区分を2回選ぶ・マスタが2つになるのを避ける）。
--   work_category_id が NULL のルール＝全区分共通（従来のルールはそのまま共通扱い）。
-- ============================================================
alter table public.account_attendance_rules
  add column if not exists work_category_id uuid references public.work_categories(id) on delete cascade;
comment on column public.account_attendance_rules.work_category_id is
  '対象の作業区分。NULL=全区分共通。打刻時は「共通＋選んだ区分」のルールを出す（2026-09-13）';
create index if not exists account_attendance_rules_category_idx
  on public.account_attendance_rules (account_id, work_category_id);

-- 打刻で選んだ区分を残す（日報の区分既定値・定時判定にも使える）
alter table public.attendance_logs
  add column if not exists work_category_id uuid references public.work_categories(id);
comment on column public.attendance_logs.work_category_id is
  '打刻時に選んだ作業区分（ルールを持つ区分がある時だけ選ぶ・無ければ NULL）（2026-09-13）';
