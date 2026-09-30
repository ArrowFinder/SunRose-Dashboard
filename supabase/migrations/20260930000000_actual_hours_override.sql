-- Correct one saved session, retaining the audit trail and normal future tracking.
begin;
create or replace function public.guard_actual_hours_override()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (tg_op='INSERT' and new.actual_hours <> 0) or
    (tg_op='UPDATE' and new.actual_hours is distinct from old.actual_hours) then
  if not public.is_owner_or_admin() then raise exception 'Only an owner or admin can correct Actual Hours'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_actual_hours_override() from public,anon,authenticated;
drop trigger if exists guard_actual_hours_override on public.work_items;
create trigger guard_actual_hours_override before insert or update on public.work_items
for each row execute function public.guard_actual_hours_override();

create or replace function public.correct_time_entry(entry_id uuid, corrected_minutes integer, expected_minutes integer, expected_task_minutes integer)
returns void language plpgsql security definer set search_path=public as $$
declare entry public.time_entries;
begin
 if not public.is_owner_or_admin() then raise exception 'Only an owner or admin can correct Actual Hours'; end if;
 if corrected_minutes is null or corrected_minutes < 0 or corrected_minutes > 1440 then raise exception 'Corrected session must be between 0 and 24 hours'; end if;
 select * into entry from public.time_entries where id=entry_id for update;
 if not found or entry.voided_at is not null then raise exception 'Time session no longer available. Refresh and try again.'; end if;
 if entry.duration_minutes is distinct from expected_minutes or
    (select coalesce(sum(duration_minutes),0) from public.time_entries where work_item_id=entry.work_item_id and voided_at is null) is distinct from expected_task_minutes::bigint then
  raise exception 'Clock time changed. Refresh and review the total before correcting it.';
 end if;
 if exists(select 1 from public.active_timers where work_item_id=entry.work_item_id) then
  raise exception 'Stop or correct the running clock on this task before changing saved time.';
 end if;
 if corrected_minutes=0 then
  update public.time_entries set voided_at=clock_timestamp(),void_reason='Owner/admin correction: session removed from Actual Hours' where id=entry_id;
 else
  update public.time_entries set duration_minutes=corrected_minutes,
   ended_at=entry.started_at + make_interval(mins=>corrected_minutes),
   note=concat_ws(E'\n',nullif(entry.note,''),'Owner/admin correction to Actual Hours') where id=entry_id;
 end if;
end $$;
revoke all on function public.correct_time_entry(uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.correct_time_entry(uuid,integer,integer,integer) to authenticated;
commit;
