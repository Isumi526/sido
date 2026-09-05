-- ============================================================
--  20260903110000_estimate_billing_tracking.sql
--  債権回収サポート（催促メール自動送信）— 今回のスコープは【未入金一覧の可視化のみ】
--  （2026-08-30・運用者判断。外部への催促メール自動送信は別チケットに切り出し・
--   第9条hard-stop対象＝文面・送信条件が未確定なため今回は実装しない）。
--
--  ★estimate_projects には既に due_date 列があるが、これは「見積の回答期限」
--   （見積依頼に対する回答期限・intake側）であり、支払期限とは別の意味。
--   混同を避けるため、支払い関連の列は明示的に別名にする。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。
-- ============================================================

alter table public.estimate_projects add column if not exists invoice_amount_yen integer;
alter table public.estimate_projects add column if not exists invoice_issued_at date;
alter table public.estimate_projects add column if not exists payment_due_date date;
alter table public.estimate_projects add column if not exists paid_at date;

comment on column public.estimate_projects.invoice_amount_yen is
  '請求金額（円）。未設定ならestimate_itemsの合計を請求額とみなす（画面側で計算）。'
  ' 端数調整や別紙合算等で見積合計と実際の請求額がズレる場合にここで上書きする。';
comment on column public.estimate_projects.invoice_issued_at is '請求書を発行した日（未入金一覧の可視化用）。';
comment on column public.estimate_projects.payment_due_date is
  '支払期限日（未入金一覧の滞留日数の起算に使う）。estimate_projects.due_date（見積回答期限）とは別物。';
comment on column public.estimate_projects.paid_at is '入金を確認した日。設定されると未入金一覧から外れる。';
