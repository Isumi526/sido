-- ============================================================
--  20260914140000_pending_edits_approval_mode.sql
--  日報承認の判定表（2026-09-10 SEED 会議・2026-09-12 決定）:
--   期限内の編集＝承認なし／期限外の編集・期限後提出・有給不足＝責任者＋オーナー／
--   申請者が現場責任者 or 責任者未設定＝オーナー1名。
--  「誰の承認で成立するか」を申請した時点で決めて持つ列。承認時に計算し直すと、その間に
--  責任者が変わって判定がひっくり返る。
--   owner_only        … オーナー1名で完了
--   owner_and_manager … 現場責任者＋オーナー
--  ★追加のみ。旧行（NULL）は EF が承認時に計算して埋める。
-- ============================================================
alter table public.daily_report_pending_edits
  add column if not exists approval_mode text
  check (approval_mode is null or approval_mode in ('owner_only', 'owner_and_manager'));

comment on column public.daily_report_pending_edits.approval_mode is
  '誰の承認で成立するか（申請時に確定）。owner_only=オーナー1名／owner_and_manager=現場責任者＋オーナー';
