-- ============================================================
--  20260815020000_overtime_start_and_break.sql
--  早朝出勤・休憩なしの通し勤務も、申請＋承認で労働時間に反映できるようにする
--  Notion: 早朝出勤・休憩なしの通し勤務を、申請＋承認で労働時間に反映できるようにする
--
--  出所: 大塚さんとの電話 2026-08-10
--   「実際、6時からやってますとかあった時とかは、あらかじめ、残業申請の方でやるしか
--     なくて、早朝という…早朝出勤というのもいるんだよね」
--   「10時休憩せずに、もうそのままぶっ通しでやりました…残業申請みたいな感じで申請を
--     出せば、じゃあいいよ、って修正させてあげたい」
--
--  ★なぜ既存の overtime_requests に足すのか（新テーブルを作らない）:
--   運用も承認画面も「作業員が申請し、管理者が承認したものだけが労働時間に反映される」
--   という同じ1本の流れ。分けると承認画面が2つになり、承認漏れの置き場が増える。
--   逐語でも「残業申請みたいな感じで申請を出せば」と同じ仕組みとして語られている。
--   worker×date の有効な申請は1件だけ、という既存の一意制約もそのまま効かせたい。
--
--  ★大原則は変えない: 管理者が決めた時間がマスタで、作業員は自分の労働時間を直接
--   触れない。ここで足すのも「申請して承認されたら反映される」枠のままで、
--   承認が無ければ従来どおり固定開始より前・既定休憩より短くは入力できない。
--
--  追加のみDDL（ADD COLUMN）。既存列・既存データに変更なし。
-- ============================================================

alter table public.overtime_requests
  -- 早朝入り。承認されるとその日だけ現場の固定開始より前を選べるようになる。
  add column if not exists requested_start_time time,
  -- 実際に取った休憩（分）。0 = 休憩なしで通した。
  --  ★NULL と 0 は意味が違う。NULL は「休憩については申請していない（既定のまま）」、
  --   0 は「休憩を取らずに通した」。boolean や既定値0にすると区別できなくなる。
  add column if not exists requested_break_minutes int
    check (requested_break_minutes is null or requested_break_minutes between 0 and 480);

comment on column public.overtime_requests.requested_start_time is
  '早朝入りの申請開始時刻。承認でその日だけ現場の固定開始より前の入力を解放する。NULL=申請なし。';
comment on column public.overtime_requests.requested_break_minutes is
  '実際に取った休憩（分）。0=休憩なしで通した。NULL=休憩については申請していない（既定のまま）。';

-- ── ロールバック手順 ────────────────────────────────
--   alter table public.overtime_requests drop column if exists requested_break_minutes;
--   alter table public.overtime_requests drop column if exists requested_start_time;
--   （列の追加のみ。落としても従来の残業申請＝終了時刻の申請はそのまま動く。）
