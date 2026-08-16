-- ============================================================
--  20260816050000_rename_schedules_category_id.sql
--  schedules.category_id → work_category_id へ改名する
--
--  ★なぜ（2026-08-16・実装中に気づいた）:
--   schedules には既に `category`（予定カテゴリ＝仕事/休み/私用など。schedule_categories）が
--   あり、そこへ作業区分の `category_id` を足すと、名前がほぼ同じで別概念の列が2つ並ぶ。
--     category      … 予定カテゴリ（カレンダー上の色分け）
--     category_id   … 作業区分（現場作業/見積/事務）
--   読む人が必ず取り違える。work_category_id にすれば参照先(work_categories)も自明。
--
--  ★今なら安全に変えられる。
--   20260816020000 で列を足したばかりで、本番・ローカルとも **値が入っている行は0件**。
--   使い始めてから改名すると、参照箇所の直し漏れが事故になる。
--
--  破壊的変更に見えるが、データが無い列の改名なので実データへの影響はない。
-- ============================================================

alter table public.schedules rename column category_id to work_category_id;

comment on column public.schedules.work_category_id is
  '作業区分（work_categories）。現場作業/見積/事務など「どの作業か」。'
  ' ★予定カテゴリ（schedules.category・カレンダーの色分け）とは別物。'
  ' 既定は「現場作業」（入力項目が増えて戸惑わないよう最初から選択済みにする）。';

-- ── ロールバック手順 ────────────────────────────────
--   alter table public.schedules rename column work_category_id to category_id;
