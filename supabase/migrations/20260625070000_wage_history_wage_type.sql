-- ============================================================
--  昇給履歴(worker_wage_history)に賃金タイプを追加（賃金タイプも発効日管理）
--  追加のみ。日当↔時給の切替も履歴に残し、過去日報は当時のタイプ×当時の単価で計算する。
--  old_wage_type=切替前/wage_type=切替後（old_unit_price/new_unit_price と対）。
-- ============================================================
alter table worker_wage_history add column if not exists wage_type text;
alter table worker_wage_history add column if not exists old_wage_type text;
