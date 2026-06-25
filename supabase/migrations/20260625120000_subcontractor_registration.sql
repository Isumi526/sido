-- ============================================================
--  20260625120000_subcontractor_registration.sql
--  ⑦ 新規下請けの自己登録フロー（メール招待→業者フォーム記入→承認制で正式登録）
--   - registration_status: 'approved'（既定＝既存業者は全て承認済み扱い）/ 'pending'（業者フォーム起票・承認待ち）
--   - registration_submitted_at: 業者がフォーム送信した日時（証跡・admin承認導線の並び替え用）
--  暫定方針＝承認制（AC3）。管理者が承認すると 'approved'＋active=true で正式登録。
--  追加のみDDL（ADD COLUMN）。既存データ・既存クエリに影響しない（既定 'approved'）。
-- ============================================================

alter table public.subcontractors
  add column if not exists registration_status text not null default 'approved',
  add column if not exists registration_submitted_at timestamptz;

-- 承認待ち業者の絞り込み用
create index if not exists subcontractors_registration_status_idx
  on public.subcontractors (account_id, registration_status);
