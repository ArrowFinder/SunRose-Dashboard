-- Preserve legacy references and historical time while requiring deliberate project assignment.
begin;
drop trigger if exists create_client_default_project on public.clients;
create or replace function public.assign_work_project() returns trigger language plpgsql security definer set search_path=public as $$
declare parent_project uuid;
begin
 if new.parent_id is not null then
  select project_id into parent_project from public.work_items where id=new.parent_id and client_id=new.client_id for update;
  if parent_project is null then raise exception 'Parent task not found for this client'; end if;
  if new.project_id is not null and new.project_id<>parent_project then raise exception 'Subtasks must use their parent project'; end if;
  new.project_id:=parent_project;
 end if;
 if tg_op='INSERT' or new.project_id is distinct from old.project_id then
  if new.project_id is null or exists(select 1 from public.projects where id=new.project_id and (is_default or lower(btrim(name))='general')) then raise exception 'Choose a specific project for this task. General is not a project option.'; end if;
 end if;
 if tg_op='UPDATE' and new.project_id is distinct from old.project_id then
  if exists(select 1 from public.active_timers where work_item_id=new.id or work_item_id in(select id from public.work_items where parent_id=new.id)) then raise exception 'Stop running timers before moving a task to another project'; end if;
 end if;
 return new;
end $$;

create function public.reject_general_project() returns trigger language plpgsql set search_path=public as $$
begin
 if new.is_default or lower(btrim(new.name))='general' then raise exception 'Use a specific project name. General is not a project option.'; end if;
 return new;
end $$;
create trigger reject_general_project before insert or update of name on public.projects for each row execute function public.reject_general_project();
revoke all on function public.reject_general_project() from public,anon,authenticated;
commit;
