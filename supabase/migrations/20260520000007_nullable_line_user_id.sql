-- 代理入力対象（LINE未登録作業員）のusersレコード作成を可能にする
alter table users
  alter column line_user_id drop not null;
