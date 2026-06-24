-- ============================================================
--  昇給履歴に「昇給年月日（発効日）」を追加
--  人件費を「日報の日付に有効だった単価」で計算するため、
--  changed_at(編集日時)とは別に、ユーザー設定の effective_date を持つ。
--  追加のみ(ADD COLUMN・nullable)。既存行は計算側で effective_date ?? changed_at::date で扱う。
-- ============================================================
alter table worker_wage_history add column if not exists effective_date date;
