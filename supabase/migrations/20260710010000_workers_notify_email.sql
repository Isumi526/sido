-- ============================================================
--  20260710010000_workers_notify_email.sql
--  作業員>詳細情報に通知用メールアドレスを登録できるようにする。
--  編集許可発行などのイベント通知の送信先（未設定なら通知しない＝任意項目）。
--  追加のみDDL（ADD COLUMN・default無し=nullable）。破壊的変更なし。
-- ============================================================
alter table workers
  add column if not exists notify_email text;

comment on column workers.notify_email is '通知メール送信先（任意）。編集許可発行等のイベント通知に使用。未設定なら通知しない。';
