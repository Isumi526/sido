-- ============================================================
--  20260920150000_personal_expenses_kind.sql
--  現場に紐づかない経費を「個人枠（budget）」と「業務経費（business）」の2区分に分ける（2026-09-05 ユーザー合意）。
--   budget   = 個人枠。月額上限を消費する（既存の挙動）
--   business = 業務経費（消耗品の買い置き等）。現場に紐づかず、枠を消費しない。全作業員が出せる
--  ★default 'budget' なので既存行（本番14件）は従来どおり枠を消費する＝移行ゼロ・挙動不変。追加のみDDL。
--  ロールバック: alter table personal_expenses drop column expense_kind;
-- ============================================================
alter table public.personal_expenses
  add column if not exists expense_kind text not null default 'budget'
    check (expense_kind in ('budget', 'business'));
comment on column public.personal_expenses.expense_kind is
  'budget=個人枠（月額上限を消費）/ business=業務経費（現場に紐づかない・枠を消費しない・全作業員が出せる）';
