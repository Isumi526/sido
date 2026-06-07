-- ============================================================
--  月次精算 支払い情報（経費管理エピック 分割B）
--  正典: docs/spec/expense.md §3 / 設計: docs/design/expense-settlement-paid.md
--  - 管理者が申請中の精算を「支払い済み」に確定する際の支払い区分・支払日
--  - 追加のみ・後方互換。既存行/既存ステータスに影響なし
-- ============================================================
alter table expense_settlements
  add column if not exists payment_method text,  -- 支払い区分: '銀行振込' | '手渡し'（支払い済み時に登録）
  add column if not exists paid_on        date;  -- 支払日（管理者入力。下請け請求 transfer_date と同方針）
