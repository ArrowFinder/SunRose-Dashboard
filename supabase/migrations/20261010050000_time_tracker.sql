begin;
alter table public.time_entries add column project_id uuid references public.projects(id);
alter table public.time_entries add column updated_at timestamptz not null default now();
alter table public.active_timers add column project_id uuid references public.projects(id);
update public.time_entries e set project_id=w.project_id from public.work_items w where w.id=e.work_item_id;
update public.active_timers e set project_id=w.project_id from public.work_items w where w.id=e.work_item_id;
alter table public.time_entries alter column work_item_id drop not null;
alter table public.active_timers alter column work_item_id drop not null;
alter table public.time_entries alter column project_id set not null;
alter table public.active_timers alter column project_id set not null;
create function public.guard_time_project() returns trigger language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
 if new.work_item_id is not null then
  select project_id into pid from public.work_items where id=new.work_item_id;
  if tg_op='INSERT' or tg_table_name='active_timers' then new.project_id:=pid;
  elsif new.work_item_id is distinct from old.work_item_id or new.project_id is distinct from old.project_id then
   if new.project_id is distinct from pid then raise exception 'Task must belong to selected project'; end if;
  end if;
 end if;
 if new.project_id is null then raise exception 'Project required'; end if;
 if tg_op='INSERT' or tg_table_name='active_timers' then
  perform 1 from public.clients c join public.projects p on p.client_id=c.id where p.id=new.project_id for update of c;
  if exists(select 1 from public.projects p join public.clients c on c.id=p.client_id where p.id=new.project_id and c.archived_at is not null) then raise exception 'Restore client before tracking time'; end if;
 end if;
 if tg_table_name='time_entries' then new.updated_at:=clock_timestamp(); end if;
 return new;
end $$;
create trigger b_time_project before insert or update on public.time_entries for each row execute function public.guard_time_project();
create trigger b_timer_project before insert or update on public.active_timers for each row execute function public.guard_time_project();
create table public.time_log_requests(user_id uuid not null references public.profiles(id),request_id uuid not null,entry_id uuid not null references public.time_entries(id),primary key(user_id,request_id));
alter table public.time_log_requests enable row level security;
revoke all on public.time_log_requests from anon,authenticated;
create function public.save_time_log(entry_id uuid, expected_updated_at timestamptz, selected_project uuid, selected_task uuid, entry_start timestamptz, entry_end timestamptz, entry_note text, entry_billable boolean, request_id uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare e public.time_entries; result uuid;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 if entry_start is null or entry_end is null or entry_end<=entry_start or entry_end>now()+interval '1 minute' or entry_end-entry_start>interval '24 hours' then raise exception 'Choose a valid time range up to 24 hours, ending in the past'; end if;
 if length(coalesce(entry_note,''))>4000 then raise exception 'Note is too long'; end if;
 if not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id where p.id=selected_project and c.archived_at is null) then raise exception 'Choose an active client project'; end if;
 if selected_task is not null and not exists(select 1 from public.work_items where id=selected_task and project_id=selected_project and archived_at is null) then raise exception 'Choose a task in this project'; end if;
 if selected_task is not null and exists(select 1 from public.work_items where parent_id=selected_task and archived_at is null) then raise exception 'Log time to a subtask or directly to the project'; end if;
 if entry_id is null then
  if request_id is not null then
   perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,9));
   select r.entry_id into result from public.time_log_requests r where r.user_id=auth.uid() and r.request_id=save_time_log.request_id;
   if found then return result; end if;
  end if;
  insert into public.time_entries(project_id,work_item_id,user_id,started_at,ended_at,duration_minutes,note,billable)
   values(selected_project,selected_task,auth.uid()::text,entry_start,entry_end,greatest(1,round(extract(epoch from(entry_end-entry_start))/60)),coalesce(entry_note,''),coalesce(entry_billable,true)) returning id into result;
  if request_id is not null then insert into public.time_log_requests values(auth.uid(),request_id,result); end if;
 else
  select * into e from public.time_entries where id=entry_id for update;
  if not found then raise exception 'Entry not found'; end if;
  if e.user_id<>auth.uid()::text and not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin','supervisor')) then raise exception 'You can edit only your own time'; end if;
  if e.voided_at is not null or e.updated_at is distinct from expected_updated_at then raise exception 'Entry changed. Refresh before editing'; end if;
  update public.time_entries set project_id=selected_project,work_item_id=selected_task,started_at=entry_start,ended_at=entry_end,duration_minutes=greatest(1,round(extract(epoch from(entry_end-entry_start))/60)),note=coalesce(entry_note,''),billable=coalesce(entry_billable,true) where id=e.id;
  result:=e.id;
 end if;
 return result;
end $$;
create or replace function public.void_time_entry(entry_id uuid, reason text) returns void language plpgsql security definer set search_path=public as $$
declare e public.time_entries;
begin
 if not public.is_internal_user() or length(btrim(coalesce(reason,'')))=0 then raise exception 'Staff access and reason required'; end if;
 select * into e from public.time_entries where id=entry_id for update;
 if not found then raise exception 'Entry not found'; end if;
 if e.user_id<>auth.uid()::text and not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin','supervisor')) then raise exception 'You can remove only your own time'; end if;
 update public.time_entries set voided_at=now(),void_reason=btrim(reason) where id=entry_id and voided_at is null;
end $$;
create or replace function public.start_work_timer(task_id uuid, request_id uuid)
returns public.active_timers language plpgsql security definer set search_path=public as $$
declare t public.active_timers; now_at timestamptz=clock_timestamp(); minutes integer;
begin
 if not public.is_internal_user() then raise exception 'Team access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if exists(select 1 from public.timer_requests r where r.user_id=auth.uid() and r.request_id=start_work_timer.request_id) then
  select * into t from public.active_timers where user_id=auth.uid(); return t;
 end if;
 if not exists(select 1 from public.work_items where id=task_id) then raise exception 'Task not found'; end if;
 select * into t from public.active_timers where user_id=auth.uid() for update;
 if found and t.work_item_id=task_id then
  insert into public.timer_requests(user_id,request_id) values(auth.uid(),request_id);
  return t;
 end if;
 if t.user_id is not null then
  minutes=greatest(1,round(extract(epoch from(now_at-t.started_at))/60));
  if minutes>1440 then raise exception 'Timer exceeds 24 hours. Stop it with a corrected end time before switching tasks.'; end if;
  insert into public.time_entries(project_id,work_item_id,user_id,started_at,ended_at,duration_minutes) values(t.project_id,t.work_item_id,auth.uid()::text,t.started_at,now_at,minutes);
 end if;
 insert into public.active_timers(user_id,work_item_id,started_at) values(auth.uid(),task_id,now_at)
 on conflict(user_id) do update set work_item_id=excluded.work_item_id,started_at=excluded.started_at returning * into t;
 insert into public.timer_requests(user_id,request_id) values(auth.uid(),request_id);
 return t;
end; $$;
create or replace function public.stop_work_timer(expected_task_id uuid, expected_started_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare t public.active_timers; now_at timestamptz=clock_timestamp(); minutes integer;
begin
 if not public.is_internal_user() then raise exception 'Team access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into t from public.active_timers where user_id=auth.uid() for update;
 if not found then return; end if;
 if t.work_item_id is distinct from expected_task_id or t.started_at is distinct from expected_started_at then raise exception 'Timer changed on another device. Refresh before stopping it.'; end if;
 minutes=greatest(1,round(extract(epoch from(now_at-t.started_at))/60));
 if minutes>1440 then raise exception 'Timer exceeds 24 hours. Use Correct timer to record the actual end time.'; end if;
 insert into public.time_entries(project_id,work_item_id,user_id,started_at,ended_at,duration_minutes) values(t.project_id,t.work_item_id,auth.uid()::text,t.started_at,now_at,minutes);
 delete from public.active_timers where user_id=auth.uid();
end; $$;
create or replace function public.correct_work_timer(expected_task_id uuid, expected_started_at timestamptz, corrected_end timestamptz, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare t public.active_timers;
begin
 if not public.is_internal_user() or length(trim(reason))=0 then raise exception 'Team access and reason required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into t from public.active_timers where user_id=auth.uid() for update;
 if not found then return; end if;
 if t.work_item_id is distinct from expected_task_id or t.started_at is distinct from expected_started_at then raise exception 'Timer changed. Refresh first.'; end if;
 insert into public.time_entries(project_id,work_item_id,user_id,started_at,ended_at,duration_minutes,note)
 values(t.project_id,t.work_item_id,auth.uid()::text,t.started_at,corrected_end,greatest(1,round(extract(epoch from(corrected_end-t.started_at))/60)),'Timer corrected: '||trim(reason));
 delete from public.active_timers where user_id=auth.uid();
end; $$;

create function public.start_project_timer(selected_project uuid) returns public.active_timers language plpgsql security definer set search_path=public as $$
declare t public.active_timers;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into t from public.active_timers where user_id=auth.uid() for update;
 if found then
  if t.project_id=selected_project and t.work_item_id is null then return t; end if;
  raise exception 'Stop your current timer before starting another';
 end if;
 insert into public.active_timers(user_id,work_item_id,project_id,started_at) values(auth.uid(),null,selected_project,clock_timestamp()) returning * into t;
 return t;
end $$;
revoke all on function public.guard_time_project() from public,anon,authenticated;
revoke all on function public.save_time_log(uuid,timestamptz,uuid,uuid,timestamptz,timestamptz,text,boolean,uuid),public.start_project_timer(uuid) from public,anon;
grant execute on function public.save_time_log(uuid,timestamptz,uuid,uuid,timestamptz,timestamptz,text,boolean,uuid),public.start_project_timer(uuid) to authenticated;
create function public.guard_client_project_timer() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.archived_at is not null and old.archived_at is null and exists(select 1 from public.active_timers t join public.projects p on p.id=t.project_id where p.client_id=new.id) then raise exception 'Stop project timers before archiving this client'; end if;
 return new;
end $$;
create trigger guard_client_project_timer before update of archived_at on public.clients for each row execute function public.guard_client_project_timer();
revoke all on function public.guard_client_project_timer() from public,anon,authenticated;
commit;
