-- 工程管理をエクセル工程表に寄せる: 工事区分(色)・請負金額・現場管理担当・メモ付箋（すべて追加のみ・非破壊）
alter table public.process_tasks
  add column if not exists work_type       text,   -- '日中' | '夜間' | '家具'（バー色分け用・null可）
  add column if not exists contract_amount  bigint, -- 請負金額（円・null可）
  add column if not exists site_manager     text,   -- 現場管理担当（担当者とは別・null可）
  add column if not exists memo             text;   -- メモ付箋（例: 入札 / 2026年1月中旬? / null可）
