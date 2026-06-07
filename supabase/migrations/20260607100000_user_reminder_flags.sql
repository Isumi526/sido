-- ============================================================
--  users に未送信者リマインド用フラグを追加（追加のみ・後方互換）
--  - is_reminder_recipient : リマインドDMを受け取る（指定ユーザー）
--  - reminder_exempt        : 未送信者チェックから除外（日報を出さない管理者）
--  既定 false。RLSは users 側で無効のため追加ポリシー不要。
-- ============================================================
alter table users add column if not exists is_reminder_recipient boolean not null default false;
alter table users add column if not exists reminder_exempt        boolean not null default false;
