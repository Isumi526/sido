-- ============================================================
--  20260830050000_paid_leave_half_and_hourly.sql
--  有給を半日・時間単位でも取れるようにする（2026-08-30）
--
--  ★これまで: 日報の leave_type='paid_leave' を1件＝1日として数えていた。
--   「午後だけ休んだ」も1日消化になり、実態と合わなかった。
--
--  ★法令の前提（実装の分岐に直結するので明記する）
--   - 半日単位年休: 法令上の定めが無く、**労使協定は不要**。会社の判断（就業規則）で導入できる。
--   - 時間単位年休: 労働基準法39条4項。**労使協定の締結が必須**で、**年5日分が上限**。
--     「1日分が何時間か」も協定で定める。
--   → 半日は無条件で使えるようにし、時間単位はアカウント設定
--     （settings.hourly_leave_enabled = 労使協定を締結している）で開く。年5日の上限も見る。
--
--  ★追加のみ（非破壊）。既存行は leave_days が null＝「1日」として扱う（読む側でフォールバック）。
--   ロールバック:
--     alter table daily_reports drop column if exists leave_days;
--     alter table daily_reports drop column if exists leave_hours;
-- ============================================================

-- 消化した量（日数）。0.5=半日、時間単位は 時間数 ÷ 1日の所定労働時間。
-- null は「1日」（この列を足す前の既存データ）。
alter table daily_reports add column if not exists leave_days numeric;

-- 時間単位で取った時の時間数（表示・証跡用）。日数換算は leave_days が正。
alter table daily_reports add column if not exists leave_hours numeric;

comment on column daily_reports.leave_days is
  '有給の消化量（日）。1=全日 / 0.5=半日 / 時間単位は 時間数÷1日の所定労働時間。'
  ' null は「1日」（2026-08-30 にこの列を足す前の既存データ）。集計はこの列を合計する。';
comment on column daily_reports.leave_hours is
  '有給を時間単位で取った時の時間数（表示・証跡用）。日数換算は leave_days が正。'
  ' 時間単位年休は労基法39条4項で労使協定が必須・年5日分が上限。';

-- 既存の有給日報を明示的に「1日」にしておく（null のままでも読む側は1日扱いだが、
-- 集計SQLを書く人が毎回 coalesce を忘れないよう、値を入れておく）
update daily_reports set leave_days = 1 where leave_type = 'paid_leave' and leave_days is null;
