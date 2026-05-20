-- ============================================================
--  Rollback: 20260520000000_schedule_groups
-- ============================================================

drop table if exists schedule_group_shares;
drop table if exists schedule_group_members;
drop table if exists schedule_groups;

alter table schedules drop column if exists is_public;
