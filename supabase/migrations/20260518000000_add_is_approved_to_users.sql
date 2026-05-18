-- ============================================================
--  users テーブルに承認フラグを追加
--  既存ユーザーはすでに使用中なので承認済みとして扱う
-- ============================================================

alter table users
  add column if not exists is_approved boolean not null default false;

-- 既存ユーザーは承認済みにする
update users set is_approved = true;
