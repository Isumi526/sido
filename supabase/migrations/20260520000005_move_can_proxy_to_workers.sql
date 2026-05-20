-- can_proxy を users から workers に移動
alter table workers
  add column if not exists can_proxy boolean not null default false;

alter table users
  drop column if exists can_proxy;
