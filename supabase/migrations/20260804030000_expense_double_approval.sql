-- ============================================================
--  20260804030000_expense_double_approval.sql
--  経費精算をダブル承認（一次承認＝役員・経理／最終承認＝オーナー）にする。
--
--  ★背景（議事録2026-07-27）: 「管理者で登録されたら自分で修正できちゃう／誰も見られることもなく」
--   ＝**自己承認できてしまう**のが問題。承認を二段にし、申請者本人は承認できないようにする。
--
--  ★status は元から CHECK 制約の無い text（既定 '申請中'）なので、
--   値 '一次承認済み' を足すだけで既存行に影響しない。
--   既存の '申請中' / '差し戻し' / '支払い済み' はそのままの意味で残る。
--
--  追加のみDDL（ADD COLUMN）。既存列の変更・削除なし。
-- ============================================================

alter table expense_settlements
  -- 一次承認（役員・経理）の記録。誰がいつ通したかを残さないと監査にならない
  add column if not exists first_approved_at   timestamptz,
  add column if not exists first_approved_by   uuid,          -- workers.id（承認した人）
  add column if not exists first_approved_name text,          -- 承認時点の氏名を固定（退職で worker 行が消えても履歴が残る）
  -- 最終承認（オーナー）の記録。支払い済みにした人＝最終承認者
  add column if not exists final_approved_by   uuid,
  add column if not exists final_approved_name text;

comment on column expense_settlements.first_approved_at is
  '一次承認（役員・経理）の日時。ここが入ると status=一次承認済み。最終承認(支払い済み)はオーナーのみ。';
comment on column expense_settlements.first_approved_name is
  '一次承認者の氏名スナップショット。表示時に引き直すと退職で承認者が消えて監査にならないため保存する。';

-- ── ロールバック手順 ────────────────────────────────
--   alter table expense_settlements
--     drop column if exists first_approved_at, drop column if exists first_approved_by,
--     drop column if exists first_approved_name, drop column if exists final_approved_by,
--     drop column if exists final_approved_name;
--   ※ status='一次承認済み' の行が残っている場合は先に '申請中' へ戻すこと。
