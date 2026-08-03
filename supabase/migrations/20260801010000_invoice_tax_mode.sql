-- ============================================================
--  20260801010000_invoice_tax_mode.sql
--  下請け請求書に「明細金額が税抜か税込か」を持たせる（内税/外税の判別）
--  Notion: 請求書処理: 消費税自動計算の判別ロジック改善(明細内包/分離)
--
--  ★何が問題だったか:
--   業者によって明細の金額が「税抜」の場合と「税込（内税）」の場合がある。
--   今の画面は常に 税込 = Σamount + Σ(amount × tax_rate/100) で計算するため、
--   内税の請求書だと**消費税を二重に足してしまい**、毎回手で金額を直していた。
--
--  ★なぜ列を足すのか（計算式を変えるだけでは駄目な理由）:
--   amount の意味（税抜なのか税込なのか）は請求書ごとに違う。どちらの意味で
--   保存されたかを持たないと、既存行を読み戻した時にどう計算すべきか決められない。
--
--  既定は 'exclusive'（＝従来どおり明細は税抜）。既存行は全てこの扱いになるので
--  **挙動は変わらない**（回帰なし）。
--
--  追加のみDDL（ADD COLUMN ＋ CHECK制約）。破壊的変更なし。
-- ============================================================

alter table subcontractor_invoices
  add column if not exists tax_mode text not null default 'exclusive';

-- 値を2つに固定する。増やす時は画面側の計算分岐も必ず一緒に直すこと。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subcontractor_invoices_tax_mode_chk'
  ) then
    alter table subcontractor_invoices
      add constraint subcontractor_invoices_tax_mode_chk
      check (tax_mode in ('exclusive', 'inclusive'));
  end if;
end $$;

comment on column subcontractor_invoices.tax_mode is
  'items.amount の意味: exclusive=税抜(消費税を別途加算) / inclusive=税込(amountに消費税を含む)';
