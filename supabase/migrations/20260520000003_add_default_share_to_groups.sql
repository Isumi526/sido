-- schedule_groups にデフォルト共有フラグを追加
alter table schedule_groups
  add column if not exists default_share boolean not null default false;
