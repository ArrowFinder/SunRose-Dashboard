create or replace function public.protect_work_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='time_entries' then raise exception 'Void time entries instead of deleting their history'; end if;
 if tg_table_name='profiles' then raise exception 'Deactivate members instead of deleting their history'; end if;
 if tg_table_name='work_items' then
 if (coalesce(old.actual_hours,0)>0 or exists(select 1 from public.time_entries where work_item_id=old.id) or exists(select 1 from public.active_timers where work_item_id=old.id)) then raise exception 'This task has time records or a running timer. Archive it to retain its history.'; end if;
 end if;
 if tg_table_name='clients' and exists(select 1 from public.work_items where client_id=old.id) then raise exception 'This client has tasks. Archive it to retain its history.'; end if;
 return old;
end; $$;
