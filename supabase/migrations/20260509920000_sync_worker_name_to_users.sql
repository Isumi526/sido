-- ============================================================
--  supabase/migrations/20260509920000
--  workers.name が更新されたとき users.real_name を自動同期する
--  workers.role が更新されたとき users.worker_role も同期する
-- ============================================================

create or replace function sync_worker_name_to_users()
returns trigger
language plpgsql
as $$
begin
  if new.name <> old.name or new.role <> old.role then
    update users
    set
      real_name   = new.name,
      worker_role = new.role,
      updated_at  = now()
    where worker_id = old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_worker_name on workers;

create trigger trg_sync_worker_name
after update on workers
for each row
execute function sync_worker_name_to_users();
