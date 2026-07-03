-- ============================================================
--  20260702050000_schedule_notifications.sql
--  予定追加時の「気づかないケース対策」＝アプリ内通知＋未読バッジ（#予定通知）。
--   - 予定が作成された時、対象作業員あてに通知行を作る。作業員が次にアプリを開いた時に
--     バッジ/バナーで気づける（LINE webview でも PWA でも動作＝秘密鍵/インフラ不要）。
--   - 回答は「A(web push)をベース＋メール併用」。web push は VAPID鍵(要ユーザー発行)＋PWAインストール
--     が前提で LINE webview では動かないため、後続で送信EFを足す。本テーブルは push/メールの
--     送信元データも兼ねられる（後続で read_at 未読分を push/メール対象にできる）。
--   - RLS は既存マスタ/schedules と同じく無効（マスタ層のRLS化は親エピックで一括）。
--   追加のみDDL（CREATE TABLE / INDEX）。非破壊・後方互換。
-- ============================================================
create table if not exists schedule_notifications (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id),
  worker_id   uuid not null references workers(id) on delete cascade,   -- 受信者（対象作業員）
  schedule_id uuid references schedules(id) on delete cascade,
  title       text,
  body        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz                                               -- null=未読
);

create index if not exists schedule_notifications_worker_unread_idx
  on schedule_notifications (worker_id, read_at);
create index if not exists schedule_notifications_account_idx
  on schedule_notifications (account_id);

alter table schedule_notifications disable row level security;
