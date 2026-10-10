-- Additive project foundation. Existing task/time identifiers are preserved.
begin;
create table public.projects (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 name text not null check(length(btrim(name)) between 1 and 160),
 description text not null default '',
 stage text not null default 'planned' check(stage in ('planned','active','on_hold','completed')),
 is_default boolean not null default false,
 billing_type text not null default 'inherit' check(billing_type in ('inherit','hourly','retainer','fixed_fee')),
 hourly_rate numeric check(hourly_rate>=0), fee numeric check(fee>=0),
 hour_budget numeric check(hour_budget>=0),
 start_date date, due_date date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(start_date is null or due_date is null or start_date<=due_date),
 unique(id,client_id)
);
create unique index projects_default_client on public.projects(client_id) where is_default;
alter table public.projects enable row level security;
grant select,insert,update on public.projects to authenticated;
grant all on public.projects to service_role;
create policy projects_read on public.projects for select to authenticated using(public.is_internal_user());
create policy projects_insert on public.projects for insert to authenticated with check(public.is_owner_or_admin());
create policy projects_update on public.projects for update to authenticated using(public.is_owner_or_admin()) with check(public.is_owner_or_admin());
insert into public.projects(client_id,name,is_default) select id,'General',true from public.clients;
alter table public.work_items add column project_id uuid;
update public.work_items w set project_id=p.id from public.projects p where p.client_id=w.client_id and p.is_default;
alter table public.work_items alter column project_id set not null;
alter table public.work_items add constraint work_project_client foreign key(project_id,client_id) references public.projects(id,client_id);
create index work_items_project_idx on public.work_items(project_id);
create function public.create_client_default_project() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.projects(client_id,name,is_default) values(new.id,'General',true);
 return new;
end $$;
create trigger create_client_default_project after insert on public.clients for each row execute function public.create_client_default_project();
create function public.guard_project() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' then
  if new.client_id<>old.client_id or new.is_default<>old.is_default then raise exception 'Project client and default status cannot change'; end if;
  new.updated_at:=now();
 end if;
 if exists(select 1 from public.clients where id=new.client_id and archived_at is not null) and not new.is_default then raise exception 'Restore the client before changing projects'; end if;
 return new;
end $$;
create trigger guard_project before insert or update on public.projects for each row execute function public.guard_project();
create function public.assign_work_project() returns trigger language plpgsql security definer set search_path=public as $$
declare parent_project uuid;
begin
 if new.parent_id is not null then
  select project_id into parent_project from public.work_items where id=new.parent_id and client_id=new.client_id for update;
  if parent_project is null then raise exception 'Parent task not found for this client'; end if;
  if new.project_id is not null and new.project_id<>parent_project then raise exception 'Subtasks must use their parent project'; end if;
  new.project_id:=parent_project;
 elsif new.project_id is null then
  select id into new.project_id from public.projects where client_id=new.client_id and is_default;
 end if;
 if tg_op='UPDATE' and new.project_id is distinct from old.project_id then
  if exists(select 1 from public.active_timers where work_item_id=new.id or work_item_id in(select id from public.work_items where parent_id=new.id)) then raise exception 'Stop running timers before moving a task to another project'; end if;
 end if;
 return new;
end $$;
create trigger assign_work_project before insert or update on public.work_items for each row execute function public.assign_work_project();
create function public.move_child_projects() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.parent_id is null and new.project_id is distinct from old.project_id then
  update public.work_items set project_id=new.project_id where parent_id=new.id;
 end if;
 return new;
end $$;
create trigger move_child_projects after update of project_id on public.work_items for each row execute function public.move_child_projects();
create trigger audit_workspace_row after insert or update or delete on public.projects for each row execute function public.audit_workspace_row();
-- Empty clients must remain removable despite their automatically created General project.
alter table public.projects drop constraint projects_client_id_fkey;
alter table public.projects add constraint projects_client_id_fkey foreign key(client_id) references public.clients(id) on delete cascade;
revoke all on function public.create_client_default_project(),public.guard_project(),public.assign_work_project(),public.move_child_projects() from public,anon,authenticated;
commit;
