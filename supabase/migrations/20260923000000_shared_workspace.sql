-- Shared workspace. Additive upgrade of the existing SunRose tables.
-- Apply after 20250201000000_profiles.sql. Existing rows are retained.
begin;
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.clients add column if not exists retainer_hours_per_month numeric not null default 40;
alter table public.clients add column if not exists share_token text not null default (gen_random_uuid()::text || gen_random_uuid()::text);
alter table public.clients add column if not exists color text;
create unique index if not exists clients_share_token_unique on public.clients(share_token);
create table if not exists public.work_items (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 year_month text not null, title text not null, description text not null default '', source text not null default 'internal',
 status text not null default 'backlog', scope_category text not null default 'in_scope', estimated_hours numeric not null default 0,
 actual_hours numeric not null default 0, priority integer not null default 10, due_date date,
 assigned_user_id text, template_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.work_items add column if not exists client_visible boolean not null default false;
create table if not exists public.time_entries (
 id uuid primary key default gen_random_uuid(), work_item_id uuid not null references public.work_items(id), user_id text not null,
 started_at timestamptz not null, ended_at timestamptz not null, duration_minutes integer not null,
 note text not null default '', billable boolean not null default true, created_at timestamptz not null default now()
);
alter table public.time_entries add column if not exists voided_at timestamptz;
alter table public.time_entries add column if not exists void_reason text;
create table if not exists public.task_templates (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id), name text not null,
 default_title text not null default '', default_description text not null default '', default_estimated_hours numeric not null default 0,
 default_scope_category text not null default 'in_scope', created_at timestamptz not null default now()
);
create table if not exists public.active_timers (
 user_id uuid primary key references public.profiles(id), work_item_id uuid not null references public.work_items(id), started_at timestamptz not null default now()
);
create table if not exists public.timer_requests (
 user_id uuid not null references public.profiles(id), request_id uuid not null, primary key(user_id, request_id)
);
create table if not exists public.workspace_audit (
 id bigint generated always as identity primary key, actor_id uuid, table_name text not null, row_id text not null,
 operation text not null, before_row jsonb, after_row jsonb, happened_at timestamptz not null default now()
);
create index if not exists work_items_client_month_idx on public.work_items(client_id, year_month);
create index if not exists time_entries_work_start_idx on public.time_entries(work_item_id, started_at);

create or replace function public.is_internal_user() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin','employee'));
$$;
create or replace function public.is_owner_or_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin'));
$$;
create or replace function public.can_view_client(cid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_internal_user() or exists(select 1 from public.client_members m join public.profiles p on p.id=m.user_id where m.user_id=auth.uid() and m.client_id=cid and p.active);
$$;
-- New signups never acquire employee access automatically.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,display_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(coalesce(new.email,''),'@',1),'User'),'client') on conflict(id) do nothing;
 return new;
end; $$;

-- Recover profiles for accounts created before the signup trigger was installed.
insert into public.profiles(id,display_name,role)
 select id,coalesce(raw_user_meta_data->>'display_name',split_part(coalesce(email,''),'@',1),'User'),'client'::public.app_role from auth.users
 on conflict(id) do nothing;

-- Replace old broad policies, including policies created outside git.
do $$ declare p record; t text; begin
 foreach t in array array['profiles','clients','client_members','work_items','time_entries','task_templates','active_timers','timer_requests','workspace_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
   execute format('drop policy %I on public.%I',p.policyname,t);
  end loop;
 end loop;
end $$;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_internal_user());
-- No direct profile writes: role and active changes go through manage_member.
create policy members_read on public.client_members for select to authenticated using(user_id=auth.uid() or public.is_owner_or_admin());
create policy clients_read on public.clients for select to authenticated using(public.is_internal_user());
create policy clients_add on public.clients for insert to authenticated with check(public.is_owner_or_admin());
create policy clients_change on public.clients for update to authenticated using(public.is_owner_or_admin()) with check(public.is_owner_or_admin());
create policy clients_remove on public.clients for delete to authenticated using(public.is_owner_or_admin());
create policy work_read on public.work_items for select to authenticated using(public.is_internal_user());
create policy work_add on public.work_items for insert to authenticated with check(public.is_internal_user());
create policy work_change on public.work_items for update to authenticated using(public.is_internal_user()) with check(public.is_internal_user());
create policy work_remove on public.work_items for delete to authenticated using(public.is_owner_or_admin());
create policy templates_read on public.task_templates for select to authenticated using(public.is_internal_user());
create policy templates_add on public.task_templates for insert to authenticated with check(public.is_internal_user());
create policy templates_change on public.task_templates for update to authenticated using(public.is_owner_or_admin()) with check(public.is_owner_or_admin());
create policy templates_remove on public.task_templates for delete to authenticated using(public.is_owner_or_admin());
create policy time_read on public.time_entries for select to authenticated using(public.is_internal_user());
create policy time_add on public.time_entries for insert to authenticated with check(public.is_internal_user() and user_id=auth.uid()::text and voided_at is null and void_reason is null);
create policy timer_read on public.active_timers for select to authenticated using(user_id=auth.uid() and public.is_internal_user());
create policy audit_read on public.workspace_audit for select to authenticated using(public.is_owner_or_admin());

create or replace function public.validate_workspace_row() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='clients' then
  if length(trim(new.name))=0 or new.retainer_hours_per_month<0 then raise exception 'Client name and nonnegative retainer required'; end if;
 elsif tg_table_name='work_items' then
  if length(trim(new.title))=0 or new.estimated_hours<0 or new.actual_hours<0 or new.year_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or new.status not in ('backlog','planned','in_progress','done') or new.source not in ('internal','client')
    or new.scope_category not in ('in_scope','needs_approval','approved_overage','out_of_scope') then raise exception 'Invalid task values'; end if;
  if new.assigned_user_id is not null and not exists(select 1 from public.profiles where id::text=new.assigned_user_id and active and role in ('owner','admin','employee')) then raise exception 'Assignee must be an active team member'; end if;
  if tg_op='UPDATE' then
   if new.id<>old.id or new.client_id<>old.client_id then raise exception 'Task identity and client cannot change'; end if;
   new.updated_at=clock_timestamp();
  end if;
 elsif tg_table_name='time_entries' then
  if new.duration_minutes<=0 or new.duration_minutes>1440 or new.ended_at<new.started_at or new.ended_at>now()+interval '1 minute'
   or new.duration_minutes<>greatest(1,round(extract(epoch from (new.ended_at-new.started_at))/60)) then raise exception 'Time must be between 1 minute and 24 hours, match its timestamps, and not be in the future'; end if;
 end if;
 return new;
end; $$;
do $$ declare t text; begin
 foreach t in array array['clients','work_items','time_entries'] loop
  execute format('drop trigger if exists validate_workspace_row on public.%I',t);
  execute format('create trigger validate_workspace_row before insert or update on public.%I for each row execute function public.validate_workspace_row()',t);
 end loop;
end $$;

create or replace function public.audit_workspace_row() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.workspace_audit(actor_id,table_name,row_id,operation,before_row,after_row)
 values(auth.uid(),tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'user_id',to_jsonb(old)->>'user_id'),tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);
end; $$;
do $$ declare t text; begin
 foreach t in array array['profiles','clients','work_items','time_entries','task_templates','active_timers','client_members'] loop
  execute format('drop trigger if exists audit_workspace_row on public.%I',t);
  execute format('create trigger audit_workspace_row after insert or update or delete on public.%I for each row execute function public.audit_workspace_row()',t);
 end loop;
end $$;
-- Guard even existing ON DELETE CASCADE relationships: financial history is never hard-deleted.
create or replace function public.protect_work_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='time_entries' then raise exception 'Void time entries instead of deleting their history'; end if;
 if tg_table_name='profiles' then raise exception 'Deactivate members instead of deleting their history'; end if;
 if tg_table_name='work_items' and (exists(select 1 from public.time_entries where work_item_id=old.id) or exists(select 1 from public.active_timers where work_item_id=old.id)) then raise exception 'This task has time records or a running timer. Keep it for your records.'; end if;
 if tg_table_name='clients' and exists(select 1 from public.work_items where client_id=old.id) then raise exception 'This client has tasks. Keep it for your records.'; end if;
 return old;
end; $$;
do $$ declare t text; begin
 foreach t in array array['profiles','clients','work_items','time_entries'] loop
  execute format('drop trigger if exists protect_work_history on public.%I',t);
  execute format('create trigger protect_work_history before delete on public.%I for each row execute function public.protect_work_history()',t);
 end loop;
end $$;

create or replace function public.manage_member(member_id uuid, member_role public.app_role, member_name text, member_active boolean, member_client_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare actor_role public.app_role; target_role public.app_role;
begin
 select role into actor_role from public.profiles where id=auth.uid() and active;
 if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Owner or admin required'; end if;
 select role into target_role from public.profiles where id=member_id for update;
 if not found then raise exception 'Account not found'; end if;
 if member_id=auth.uid() then raise exception 'You cannot change your own access'; end if;
 if actor_role<>'owner' and (target_role in ('owner','admin') or member_role in ('owner','admin')) then raise exception 'Owner required for administrator access'; end if;
 if not member_active and exists(select 1 from public.active_timers where user_id=member_id) then raise exception 'Stop this member''s timer before deactivating the account'; end if;
 if member_role='client' and member_client_id is null then raise exception 'Select a client'; end if;
 update public.profiles set role=member_role, display_name=trim(member_name), active=member_active, updated_at=now() where id=member_id;
 delete from public.client_members where user_id=member_id;
 if member_role='client' then insert into public.client_members(user_id,client_id) values(member_id,member_client_id); end if;
end; $$;

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
  insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values(t.work_item_id,auth.uid()::text,t.started_at,now_at,minutes);
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
 if t.work_item_id<>expected_task_id or t.started_at<>expected_started_at then raise exception 'Timer changed on another device. Refresh before stopping it.'; end if;
 minutes=greatest(1,round(extract(epoch from(now_at-t.started_at))/60));
 if minutes>1440 then raise exception 'Timer exceeds 24 hours. Use Correct timer to record the actual end time.'; end if;
 insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values(t.work_item_id,auth.uid()::text,t.started_at,now_at,minutes);
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
 if t.work_item_id<>expected_task_id or t.started_at<>expected_started_at then raise exception 'Timer changed. Refresh first.'; end if;
 insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes,note)
 values(t.work_item_id,auth.uid()::text,t.started_at,corrected_end,greatest(1,round(extract(epoch from(corrected_end-t.started_at))/60)),'Timer corrected: '||trim(reason));
 delete from public.active_timers where user_id=auth.uid();
end; $$;
create or replace function public.void_time_entry(entry_id uuid, reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_owner_or_admin() or length(trim(reason))=0 then raise exception 'Owner/admin and reason required'; end if;
 update public.time_entries set voided_at=now(),void_reason=trim(reason) where id=entry_id and voided_at is null;
 if not found then raise exception 'Time entry not found or already voided'; end if;
end; $$;

-- Possession of a share link grants only these deliberately narrow fields.
create or replace function public.shared_client_view(token text, month text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid; cname text; items jsonb;
begin
 select id,name into cid,cname from public.clients where share_token=token;
 if not found then raise exception 'Client link not found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'dueDate',due_date) order by priority,title),'[]'::jsonb)
 into items from public.work_items where client_id=cid and year_month=month and client_visible;
 return jsonb_build_object('client',jsonb_build_object('name',cname),'items',items);
end; $$;
create or replace function public.submit_client_request(token text, request_id uuid, request_title text, request_description text)
returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
 select id into cid from public.clients where share_token=token;
 if not found then raise exception 'Client link not found'; end if;
 if length(trim(request_title)) not between 1 and 200 or length(request_description)>10000 then raise exception 'Request title or description is too long'; end if;
 perform pg_advisory_xact_lock(hashtextextended(cid::text,1));
 if exists(select 1 from public.work_items where id=request_id and client_id=cid and source='client') then return; end if;
 if (select count(*) from public.work_items where client_id=cid and source='client' and created_at>now()-interval '1 hour')>=20 then raise exception 'Too many requests. Please try again later.'; end if;
 insert into public.work_items(id,client_id,year_month,title,description,source,status,scope_category,client_visible)
 values(request_id,cid,to_char(now() at time zone 'America/Los_Angeles','YYYY-MM'),trim(request_title),trim(request_description),'client','backlog','needs_approval',true);
end; $$;

-- Signed-in clients use the same narrow fields as share-link visitors.
create or replace function public.member_client_view() returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid; client jsonb; items jsonb;
begin
 select m.client_id into cid from public.client_members m join public.profiles p on p.id=m.user_id where m.user_id=auth.uid() and p.active and p.role='client';
 if not found then return null; end if;
 select jsonb_build_object('id',id,'name',name,'color',color,'createdAt',created_at) into client from public.clients where id=cid;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'clientId',client_id,'title',title,'status',status,'dueDate',due_date,'yearMonth',year_month) order by priority,title),'[]'::jsonb) into items from public.work_items where client_id=cid and client_visible;
 return jsonb_build_object('client',client,'items',items);
end; $$;

-- A small revision check avoids downloading all tasks every 30 seconds.
create or replace function public.workspace_revision() returns bigint language sql stable security definer set search_path=public as $$
 select case when public.is_internal_user() then coalesce((select max(id) from public.workspace_audit),0) else null end;
$$;

-- Explicit grants: no browser gets privileged keys or direct timer/audit writes.
grant usage on schema public to authenticated,anon;
grant select on public.profiles,public.client_members,public.active_timers,public.workspace_audit to authenticated;
grant select,insert,update,delete on public.clients,public.work_items,public.task_templates to authenticated;
grant select,insert on public.time_entries to authenticated;
revoke insert,update,delete on public.profiles,public.client_members,public.active_timers,public.workspace_audit,public.timer_requests from authenticated,anon;
revoke update,delete on public.time_entries from authenticated,anon;
revoke all on public.timer_requests from authenticated,anon;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('member_client_view','workspace_revision','is_internal_user','is_owner_or_admin','can_view_client','manage_member','start_work_timer','stop_work_timer','correct_work_timer','void_time_entry','shared_client_view','submit_client_request','validate_workspace_row','audit_workspace_row','protect_work_history','handle_new_user') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname in ('shared_client_view','submit_client_request') then execute format('grant execute on function %s to anon,authenticated',f.signature);
  elsif f.proname in ('member_client_view','workspace_revision','is_internal_user','is_owner_or_admin','can_view_client','manage_member','start_work_timer','stop_work_timer','correct_work_timer','void_time_entry') then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
commit;
