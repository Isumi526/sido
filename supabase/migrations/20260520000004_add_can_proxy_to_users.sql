-- 代理操作者フラグ
alter table users
  add column if not exists can_proxy boolean not null default false;
