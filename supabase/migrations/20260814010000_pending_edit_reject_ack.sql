-- ============================================================
--  20260814010000_pending_edit_reject_ack.sql
--  差し戻しを申請者（作業員）に届ける
--  Notion: 日報編集の差し戻しが作業員に何も届かない（無音で消える）
--
--  ★背景:
--   管理者が差し戻すと daily_report_pending_edits が status='rejected' になるだけで、
--   LIFF 側には一切表示されず通知も飛んでいなかった。作業員から見えるのは
--   「承認待ちバッジが黙って消える」だけで、承認との区別すらつかない。
--   ＝差し戻し運用そのものが成立していなかった（2026-08-14 発覚）。
--
--  ★この列が要る理由:
--   差し戻しは「読んだら消える」お知らせにしたい。既読を持たないと、
--   作業員が再提出しない限り通知が永久に残るか、あるいは
--   「一度表示したら消す」しかなくなり見落としたら二度と出せない。
--   reviewed_at からの経過日数で自動的に消す案も検討したが、
--   見ていないまま消えるのは差し戻しの用途（直させる）と真逆なので採らない。
--
--  追加のみDDL（ADD COLUMN）。既存データ・既存列に変更なし。
-- ============================================================

alter table daily_report_pending_edits
  add column if not exists acknowledged_at timestamptz;

comment on column daily_report_pending_edits.acknowledged_at is
  '差し戻しを申請者が確認した日時。NULL の間だけ LIFF に「差し戻されました」として出す。'
  ' 明示的な「確認」操作か、同じ日報を出し直した時に埋まる。';

-- 未確認の差し戻しを申請者ごとに引く（LIFF の pending-dates と同時に読む）。
create index if not exists drpe_unacked_rejected_idx
  on daily_report_pending_edits(account_id, report_user_id)
  where status = 'rejected' and acknowledged_at is null;

-- ── ロールバック手順 ────────────────────────────────
--   drop index if exists drpe_unacked_rejected_idx;
--   alter table daily_report_pending_edits drop column if exists acknowledged_at;
--   （列の追加のみ。落としても差し戻しの記録本体（status/reject_reason）は無傷。）
