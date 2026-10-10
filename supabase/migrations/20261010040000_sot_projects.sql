begin;
create or replace function public.sot_accept_reviewed(suggestion_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions; cid uuid; rid uuid; pid uuid; project uuid; existing public.work_items; contact text; actor_name text;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() for update;
 if not found then raise exception 'Suggestion not found'; end if;
 if s.status='accepted' then return s.result_id; end if;
 if s.status<>'pending' then raise exception 'Suggestion was dismissed'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.dedupe_key,0));
 if s.kind='client' then
  if coalesce((s.payload#>>'{checklist,business_name}')::boolean,false) is not true
   or coalesce((s.payload#>>'{checklist,contact_email}')::boolean,false) is not true
   or coalesce((s.payload#>>'{checklist,relationship_evidence}')::boolean,false) is not true
   or coalesce((s.payload#>>'{checklist,existing_clients_checked}')::boolean,false) is not true then raise exception 'Complete the client checklist first'; end if;
 end if;
 if coalesce((s.payload#>>'{checklist,identity_resolved}')::boolean,false) is not true then raise exception 'Confirm which business this conversation concerns'; end if;
 select result_id into rid from public.sot_accepted where dedupe_key=s.dedupe_key;
 if rid is not null and s.kind<>'client' then
  update public.sot_suggestions set status='accepted',result_id=rid,updated_at=now() where id=s.id;
  return rid;
 end if;
 contact:=lower(trim(s.payload->>'contact_email'));
 cid:=nullif(s.payload->>'client_id','')::uuid;

 if cid is null then
  select id into cid from public.clients where lower(trim(name))=lower(trim(s.payload->>'client_name')) order by created_at limit 1;
 end if;
 if coalesce((s.payload->>'identity_confirmed')::boolean,false) is not true and exists(
  select 1 from public.sot_client_contacts m where m.email=contact and (cid is null or m.client_id<>cid)
 ) and not exists(select 1 from public.sot_client_contacts where email=contact and client_id=cid) then raise exception 'This contact also represents another business. Confirm the business first'; end if;
 if s.kind='client' then
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(s.payload->>'client_name')),1));
  if cid is null then select id into cid from public.clients where lower(trim(name))=lower(trim(s.payload->>'client_name')) order by created_at limit 1; end if;
  if cid is null then
   if length(trim(coalesce(s.payload->>'client_name',''))) not between 1 and 160 then raise exception 'Client name required'; end if;
   insert into public.clients(name,retainer_hours_per_month) values(trim(s.payload->>'client_name'),0) returning id into cid;
  end if;
  if contact is not null and contact<>'' then insert into public.sot_client_contacts(email,client_id) values(contact,cid) on conflict(email,client_id) do nothing; end if;
  insert into public.sot_client_profiles(client_id,aliases,location,business_type,website_url,website_sources)
   values(cid,array(select jsonb_array_elements_text(coalesce(s.payload->'aliases','[]'::jsonb))),s.payload->>'location',s.payload->>'business_type',
   case when s.payload->>'website_confirmed'='true' then s.payload#>>'{website_candidate,url}' else null end,
   case when s.payload->>'website_confirmed'='true' then coalesce(s.payload#>'{website_candidate,sources}','[]'::jsonb) else '[]'::jsonb end)
   on conflict(client_id) do update set
    aliases=array(select distinct unnest(sot_client_profiles.aliases||excluded.aliases)),
    location=coalesce(sot_client_profiles.location,excluded.location),business_type=coalesce(sot_client_profiles.business_type,excluded.business_type),
    website_url=coalesce(sot_client_profiles.website_url,excluded.website_url),
    website_sources=case when sot_client_profiles.website_url is null then excluded.website_sources else sot_client_profiles.website_sources end;
  rid:=cid;
 else
  if cid is null or not exists(select 1 from public.clients where id=cid and archived_at is null) then raise exception 'Add the suggested client first'; end if;
  if s.kind='task' then
   pid:=nullif(s.payload->>'parent_id','')::uuid;
   if pid is not null and not exists(select 1 from public.work_items where id=pid and client_id=cid and parent_id is null and archived_at is null) then raise exception 'Parent task changed; review the suggestion again'; end if;
   project:=nullif(s.payload->>'project_id','')::uuid;
   if pid is not null then select project_id into project from public.work_items where id=pid and archived_at is null; end if;
   if project is null then raise exception 'Choose a project before adding this task'; end if;
   if not exists(select 1 from public.projects where id=project and client_id=cid) then raise exception 'Choose a project belonging to this client'; end if;
   perform pg_advisory_xact_lock(hashtextextended(cid::text||lower(trim(s.title)),2));
   select id into rid from public.work_items where client_id=cid and project_id=project and lower(trim(title))=lower(trim(s.title))
    and parent_id is not distinct from pid and due_date is not distinct from nullif(s.payload->>'due_date','')::date order by created_at limit 1;
   if rid is null then
   insert into public.work_items(client_id,project_id,parent_id,year_month,title,description,due_date,estimated_hours,assigned_user_id,status,client_visible)
   values(cid,project,pid,coalesce(nullif(left(s.payload->>'due_date',7),''),to_char(now(),'YYYY-MM')),s.title,s.description,
    nullif(s.payload->>'due_date','')::date,coalesce((s.payload->>'estimated_hours')::numeric,0),auth.uid()::text,'planned',false) returning id into rid;
   select display_name into actor_name from public.profiles where id=auth.uid();
   insert into public.sot_notifications(recipient_id,task_id,message)
    select id,rid,coalesce(actor_name,'A teammate')||' added a task from SOT: '||s.title from public.profiles where active and role in ('owner','supervisor');
   end if;
  else
   select * into existing from public.work_items where id=(s.payload->>'task_id')::uuid and client_id=cid for update;
   if not found or existing.archived_at is not null then raise exception 'Task no longer exists or is archived'; end if;
   if existing.updated_at is distinct from (s.payload->>'expected_updated_at')::timestamptz then raise exception 'Task changed since this suggestion. Open the existing task to review it before dismissing this suggestion.'; end if;
   if exists(select 1 from public.work_items where parent_id=existing.id) then raise exception 'Update individual subtasks instead'; end if;
   rid:=existing.id;
   if s.kind='complete' then
    if exists(select 1 from public.active_timers where work_item_id=rid) then raise exception 'Stop the running clock before completing this task'; end if;
    update public.work_items set status='done' where id=rid;
   else
    update public.work_items set title=s.title,description=existing.description||E'\n\nSOT update: '||s.description,
     due_date=coalesce(nullif(s.payload->>'due_date','')::date,due_date),estimated_hours=coalesce((s.payload->>'estimated_hours')::numeric,estimated_hours) where id=rid;
   end if;
  end if;
 end if;
 if cid is not null and contact is not null and contact<>'' then insert into public.sot_client_contacts(email,client_id) values(contact,cid) on conflict(email,client_id) do nothing; end if;
 insert into public.sot_accepted(dedupe_key,kind,result_id) values(s.dedupe_key,s.kind,rid) on conflict(dedupe_key) do nothing;
 update public.sot_suggestions set status='accepted',result_id=rid,updated_at=now() where id=s.id;
 return rid;
end; $$;

-- Approval creates a project and its first task together, or neither. No new
-- project privilege is granted to employees through this security-definer RPC.
create function public.sot_approve_project_and_task(suggestion_id uuid, expected_updated_at timestamptz, edited_title text, edited_description text, selected_client uuid, approved_project_name text, edited_due date, edited_estimate numeric) returns uuid
language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions; pid uuid; pname text; task uuid;
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin must approve a new project'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() for update;
 if not found then raise exception 'Suggestion not found'; end if;
 if s.status='accepted' then return s.result_id; end if;
 if s.status<>'pending' or s.kind<>'task' or s.archived_at is not null or s.updated_at is distinct from expected_updated_at then raise exception 'Suggestion changed. Refresh before editing.'; end if;
 if not exists(select 1 from public.clients where id=selected_client and archived_at is null) then raise exception 'Choose an active client'; end if;
 pname:=btrim(approved_project_name);
 if pname is null or length(pname) not between 1 and 160 then raise exception 'Enter a project name up to 160 characters'; end if;
 perform pg_advisory_xact_lock(hashtextextended(selected_client::text||lower(pname),7));
 select id into pid from public.projects where client_id=selected_client and lower(btrim(name))=lower(pname) order by created_at limit 1;
 if pid is not null then raise exception 'A project with this name already exists. Choose it from existing projects.'; end if;
 insert into public.projects(client_id,name,stage,description) values(selected_client,pname,'planned','') returning id into pid;
 task:=public.sot_edit_and_accept(suggestion_id,expected_updated_at,edited_title,edited_description,selected_client,pid,null,edited_due,edited_estimate);
 if not exists(select 1 from public.work_items where id=task and project_id=pid) then raise exception 'This task was already added. Choose its existing project instead.'; end if;
 return task;
end $$;
revoke all on function public.sot_approve_project_and_task(uuid,timestamptz,text,text,uuid,text,date,numeric) from public,anon;
grant execute on function public.sot_approve_project_and_task(uuid,timestamptz,text,text,uuid,text,date,numeric) to authenticated;
commit;
