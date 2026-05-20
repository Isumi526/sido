-- can_proxy を削除し、proxy_operator_id（代理人のworker_id）に置き換え
alter table workers
  drop column if exists can_proxy,
  add column if not exists proxy_operator_id uuid references workers(id) on delete set null;
