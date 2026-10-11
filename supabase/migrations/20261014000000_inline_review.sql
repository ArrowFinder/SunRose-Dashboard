begin;
-- Explicit user-created records are immediately shared; cancelling a suggestion does not delete them.
create function public.review_create_client(client_name text, client_context text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare cid uuid;begin
 if not is_owner_or_admin() then raise exception 'Owner or admin required';end if;
 if client_name is null or length(btrim(client_name)) not between 1 and 200 or length(coalesce(client_context,''))>10000 then raise exception 'Enter a client name and context under 10000 characters';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(btrim(client_name)),1));
 select id into cid from clients where lower(btrim(name))=lower(btrim(client_name)) order by created_at limit 1;
 if cid is not null then
  if exists(select 1 from clients where id=cid and archived_at is not null) then raise exception 'This client is archived. Restore it before adding work.';end if;
  return cid;
 end if;
 insert into clients(name,retainer_hours_per_month) values(btrim(client_name),0) returning id into cid;
 insert into sot_client_profiles(client_id,context_notes) values(cid,coalesce(client_context,''));
 return cid;
end $$;
create function public.review_create_project(selected_client uuid, project_name text, project_scope text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare pid uuid;begin
 if not is_owner_or_admin() then raise exception 'Owner or admin required';end if;
 if not exists(select 1 from clients where id=selected_client and archived_at is null) then raise exception 'Choose an active client';end if;
 if project_name is null or length(btrim(project_name)) not between 1 and 160 or length(coalesce(project_scope,''))>10000 then raise exception 'Enter a project name and scope under 10000 characters';end if;
 perform pg_advisory_xact_lock(hashtextextended(selected_client::text||lower(btrim(project_name)),7));
 select id into pid from projects where client_id=selected_client and lower(btrim(name))=lower(btrim(project_name)) order by created_at limit 1;
 if pid is not null then
  if exists(select 1 from projects where id=pid and (is_default or stage='completed')) then raise exception 'Choose an active, specific project';end if;
  return pid;
 end if;
 insert into projects(client_id,name,description) values(selected_client,btrim(project_name),coalesce(project_scope,'')) returning id into pid;
 return pid;
end $$;
create function public.sot_review_submit(suggestion_id uuid, expected_updated_at timestamptz, edited_title text, edited_description text, selected_client uuid, selected_project uuid, selected_parent uuid, edited_due date, edited_estimate numeric, selected_assignee uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare s sot_suggestions; rid uuid; stamp timestamptz; cname text; existing_ids uuid[];
begin
 if not is_internal_user() then raise exception 'Staff access required';end if;
 select * into s from sot_suggestions where id=suggestion_id for update;
 if not found or (s.user_id<>auth.uid() and not (s.kind='project' and is_owner_or_admin())) then raise exception 'Suggestion not found';end if;
 if s.status='accepted' then return s.result_id;end if;
 if s.status<>'pending' or s.archived_at is not null or s.updated_at is distinct from expected_updated_at then raise exception 'Suggestion changed. Close and reopen it before saving.';end if;
 if s.kind='project' then
  if not is_owner_or_admin() then raise exception 'Owner or admin required';end if;
  select name into cname from clients where id=selected_client and archived_at is null;
  if not found then raise exception 'Choose an active client';end if;
  insert into workspace_audit(actor_id,table_name,row_id,operation,before_row,after_row) values(auth.uid(),'sot_suggestions',s.id::text,'EDIT_BEFORE_ADD',to_jsonb(s),jsonb_build_object('client_id',selected_client,'client_name',cname));
  update sot_suggestions set payload=jsonb_set(payload||jsonb_build_object('client_id',selected_client,'client_name',cname,'identity_confirmed',true),'{checklist}',coalesce(payload->'checklist','{}')||'{"identity_resolved":true}'::jsonb),updated_at=now() where id=s.id returning updated_at into stamp;
  return sot_accept_project(s.id,stamp,edited_title,edited_description);
 end if;
 if s.kind='task' then
  if selected_assignee is null or not exists(select 1 from profiles where id=selected_assignee and active and role in ('owner','admin','supervisor','employee')) then raise exception 'Choose an active teammate';end if;
  select array_agg(id) into existing_ids from work_items where client_id=selected_client;
 end if;
 if s.kind='complete' then return sot_accept(s.id);end if;
 rid:=sot_edit_and_accept(s.id,expected_updated_at,edited_title,edited_description,selected_client,selected_project,selected_parent,edited_due,edited_estimate);
 if s.kind='task' and not (rid=any(coalesce(existing_ids,'{}'::uuid[]))) then
  update work_items set assigned_user_id=selected_assignee::text where id=rid;
 end if;
 return rid;
end $$;
revoke all on function public.review_create_client(text,text),public.review_create_project(uuid,text,text),public.sot_review_submit(uuid,timestamptz,text,text,uuid,uuid,uuid,date,numeric,uuid) from public,anon;
grant execute on function public.review_create_client(text,text),public.review_create_project(uuid,text,text),public.sot_review_submit(uuid,timestamptz,text,text,uuid,uuid,uuid,date,numeric,uuid) to authenticated;

-- Provisioning is server-only. No setup links/tokens are stored in this table.
create table public.team_setup_requests(id uuid primary key,actor_id uuid not null references profiles(id),email text not null unique,display_name text not null,role app_role not null check(role in ('employee','supervisor','admin','owner')),user_id uuid references profiles(id),created_at timestamptz not null default now());
alter table public.team_setup_requests enable row level security;
revoke all on public.team_setup_requests from public,anon,authenticated;
grant all on public.team_setup_requests to service_role;
create function public.prepare_team_setup(actor uuid,request_id uuid,member_email text,member_name text,member_role app_role) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r team_setup_requests; existing_id uuid;begin
 if not exists(select 1 from profiles where id=actor and active and role in ('owner','admin')) then raise exception 'Owner or admin required';end if;
 if member_email is null or member_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(member_email)>254 or member_name is null or length(btrim(member_name)) not between 1 and 100 or member_role is null or member_role not in ('employee','supervisor','admin','owner') then raise exception 'Enter a name, valid email and staff role';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(btrim(member_email)),19));
 select * into r from team_setup_requests where email=lower(btrim(member_email));
 if found then
  if r.display_name<>btrim(member_name) or r.role<>member_role then raise exception 'An account setup already exists with different details. Manage its access on Team.';end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from auth.users where lower(email)=lower(btrim(member_email))) then raise exception 'This email already has an account. Manage its access on Team.';end if;
 if (select count(*) from team_setup_requests where actor_id=actor and created_at>now()-interval '1 hour')>=20 then raise exception 'Too many account requests. Try later.';end if;
 insert into team_setup_requests(id,actor_id,email,display_name,role) values(request_id,actor,lower(btrim(member_email)),btrim(member_name),member_role) returning * into r;
 return to_jsonb(r);
end $$;
create function public.finish_team_setup(actor uuid,request_id uuid,account_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r team_setup_requests;begin
 if not exists(select 1 from profiles where id=actor and active and role in ('owner','admin')) then raise exception 'Owner or admin required';end if;
 select * into r from team_setup_requests where id=request_id for update;
 if not found then raise exception 'Account request not found';end if;
 if r.user_id is not null then
  if r.user_id<>account_id then raise exception 'Account changed';end if;
  return;
 end if;
 if not exists(select 1 from auth.users where id=account_id and lower(email)=r.email and raw_user_meta_data->>'team_setup_id'=r.id::text) then raise exception 'Account does not match the setup request';end if;
 update profiles set display_name=r.display_name,role=r.role,active=true,updated_at=now() where id=account_id;
 if not found then raise exception 'Account profile missing';end if;
 update team_setup_requests set user_id=account_id where id=r.id;
 insert into workspace_audit(actor_id,table_name,row_id,operation,after_row) values(actor,'profiles',account_id::text,'ADD_TEAMMATE',jsonb_build_object('display_name',r.display_name,'role',r.role));
end $$;
revoke all on function public.prepare_team_setup(uuid,uuid,text,text,app_role),public.finish_team_setup(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_team_setup(uuid,uuid,text,text,app_role),public.finish_team_setup(uuid,uuid,uuid) to service_role;
commit;
