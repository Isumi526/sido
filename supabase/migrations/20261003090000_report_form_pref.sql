-- ============================================================
--  日報のフォームの既定（従来／ステップ式）を作業員ごとに残す（2026-10-02 設計「日報の入力と承認画面」R-3）
--  最後に選んだ方を次回の既定にする（端末を跨いで効かせる）。書くのは EF(push-settings の report-form-set) だけ。
--  ★追加のみ（既存の行は NULL＝従来フォーム）
-- ============================================================
alter table public.users add column if not exists report_form_pref text check (report_form_pref in ('classic', 'steps'));
comment on column public.users.report_form_pref is '日報のフォームの既定（classic=従来 / steps=ステップ式）。NULL は従来';
