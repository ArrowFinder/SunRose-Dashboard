begin;
-- Recovery is explicit and never reserves paid calls by itself.
alter table public.sot_mail_queue add column focus_message_ids text[],add column resolved_through timestamptz;
alter table public.sot_message_receipts add column review_method text not null default 'analysis' check(review_method in ('analysis','manual'));
create table public.sot_fetch_retries (
 user_id uuid references public.sot_connections(user_id) on delete cascade,
 thread_id text not null, first_failed_at timestamptz not null default now(),
 scan_after timestamptz not null default now()-interval '7 days', last_failed_at timestamptz not null default now(), primary key(user_id,thread_id)
);
alter table public.sot_fetch_retries enable row level security;
revoke all on public.sot_fetch_retries from public,anon,authenticated;
grant all on public.sot_fetch_retries to service_role;
create function public.sot_record_fetch_failure(uid uuid, thread text, since_time timestamptz default now()-interval '7 days') returns void language sql security definer set search_path=public as $$
 insert into sot_fetch_retries(user_id,thread_id,scan_after) values(uid,thread,since_time)
 on conflict(user_id,thread_id) do update set last_failed_at=now(),scan_after=least(sot_fetch_retries.scan_after,excluded.scan_after);
$$;
revoke all on function public.sot_record_fetch_failure(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sot_record_fetch_failure(uuid,text,timestamptz) to service_role;
create function public.sot_review_messages(thread text) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not is_internal_user() then raise exception 'Staff access required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m->>'id','subject',m->>'subject','date',m->>'date','bytes',octet_length(m::text))) from sot_mail_queue q cross join lateral jsonb_array_elements(coalesce(q.payload->'messages','[]')) m where q.user_id=auth.uid() and q.thread_id=thread and q.status='review'),'[]');
end $$;
create function public.sot_recover_thread(thread text, action text, selected_ids text[] default null, reason text default '') returns void language plpgsql security definer set search_path=public as $$
declare q sot_mail_queue; mid text; chosen jsonb; lease uuid:=gen_random_uuid();
begin
 if not is_internal_user() then raise exception 'Staff access required';end if;
 -- Do not race the collector or a saved AI answer.
 if not sot_claim_scan(auth.uid(),lease) then raise exception 'Wait for the current scan to finish';end if;
 select * into q from sot_mail_queue where user_id=auth.uid() and thread_id=thread for update;
 if (q.user_id is null or q.status='done') and exists(select 1 from sot_fetch_retries where user_id=auth.uid() and thread_id=thread) then
  insert into sot_mail_queue(user_id,thread_id,fingerprint,status,oldest_at) values(auth.uid(),thread,'unread','review',now())
   on conflict(user_id,thread_id) do update set status='review';
  select * into q from sot_mail_queue where user_id=auth.uid() and thread_id=thread for update;
 end if;
 if q.user_id is null or q.status<>'review' then raise exception 'Review item changed. Refresh first';end if;
 if action='retry' then
  if jsonb_array_length(coalesce(q.payload->'messages','[]'))=0 then
   perform sot_record_fetch_failure(auth.uid(),thread);
  else
   if coalesce(cardinality(selected_ids),0)=0 then raise exception 'Select the messages to retry';end if;
   if exists(select 1 from unnest(selected_ids) x where not exists(select 1 from jsonb_array_elements(q.payload->'messages') m where m->>'id'=x)) then raise exception 'Message selection changed';end if;
   select jsonb_agg(m) into chosen from jsonb_array_elements(q.payload->'messages') m where m->>'id'=any(selected_ids);
   if octet_length(chosen::text)>9000 then raise exception 'Select fewer messages, or review the conversation in Gmail and resolve it manually';end if;
   update sot_mail_queue set status='ready',focus_message_ids=selected_ids,reason=null,updated_at=now() where user_id=auth.uid() and thread_id=thread;
  end if;
 elsif action='resolve' then
  if length(btrim(reason)) not between 3 and 2000 then raise exception 'Describe how this conversation was handled';end if;
  for mid in select m->>'id' from jsonb_array_elements(coalesce(q.payload->'messages','[]')) m loop
   insert into sot_message_receipts(user_id,message_id,review_method) values(auth.uid(),mid,'manual') on conflict do nothing;
  end loop;
  update sot_mail_queue set status='done',payload='{}',focus_message_ids=null,resolved_through=now(),reason=btrim(sot_recover_thread.reason),updated_at=now() where user_id=auth.uid() and thread_id=thread;
  delete from sot_fetch_retries where user_id=auth.uid() and thread_id=thread;
 else raise exception 'Unknown recovery action';end if;
 insert into workspace_audit(actor_id,table_name,row_id,operation,after_row) values(auth.uid(),'sot_mail_queue',thread,'RECOVER',jsonb_build_object('action',action,'message_ids',selected_ids,'reason',reason));
 update sot_connections set next_scan_at=now() where user_id=auth.uid();
 delete from sot_scan_locks where user_id=auth.uid() and lease_id=lease;
end $$;
revoke all on function public.sot_review_messages(text),public.sot_recover_thread(text,text,text[],text) from public,anon;
grant execute on function public.sot_review_messages(text),public.sot_recover_thread(text,text,text[],text) to authenticated;
create or replace function public.sot_finish_batch(job uuid, results jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare j public.sot_batch_jobs; item jsonb; mid text; before_count int; after_count int; remaining jsonb;begin
 select * into j from sot_batch_jobs where id=job for update;
 if not found then raise exception 'Batch missing';end if;
 if j.status='complete' then return 0;end if;
 if j.status<>'answered' then raise exception 'Batch has no saved answer';end if;
 if jsonb_array_length(results)<>jsonb_array_length(j.snapshot->'threads') or (select count(distinct value->>'thread_id') from jsonb_array_elements(results))<>jsonb_array_length(results) then raise exception 'Incomplete batch results';end if;
 select count(*) into before_count from sot_suggestions where user_id=j.user_id;
 for item in select * from jsonb_array_elements(results) loop
  if not exists(select 1 from jsonb_array_elements(j.snapshot->'threads') t where t->>'thread_id'=item->>'thread_id' and t->>'fingerprint'=item->>'fingerprint') then raise exception 'Batch source mismatch';end if;
  perform sot_store_thread(j.user_id,item->>'thread_id',item->>'fingerprint',item->'proposals');
 end loop;
 for item in select * from jsonb_array_elements(j.snapshot->'threads') loop
  for mid in select jsonb_array_elements_text(item->'message_ids') loop
   insert into sot_message_receipts(user_id,message_id) values(j.user_id,mid) on conflict do nothing;
  end loop;
  select coalesce(jsonb_agg(m),'[]') into remaining from sot_mail_queue q cross join lateral jsonb_array_elements(coalesce(q.payload->'messages','[]')) m
   where q.user_id=j.user_id and q.thread_id=item->>'thread_id' and not exists(select 1 from sot_message_receipts r where r.user_id=j.user_id and r.message_id=m->>'id');
  if jsonb_array_length(remaining)>0 then delete from sot_scan_cache where user_id=j.user_id and thread_id=item->>'thread_id';end if;
  update sot_mail_queue set status=case when jsonb_array_length(remaining)>0 then 'review' else 'done' end,
   payload=case when jsonb_array_length(remaining)>0 then jsonb_set(payload,'{messages}',remaining) else '{}'::jsonb end,
   focus_message_ids=null,reason=case when jsonb_array_length(remaining)>0 then 'Remaining messages need review after a focused retry.' end,updated_at=now()
   where user_id=j.user_id and thread_id=item->>'thread_id' and fingerprint=item->>'fingerprint';
 end loop;
 select count(*) into after_count from sot_suggestions where user_id=j.user_id;
 update sot_batch_jobs set status='complete',snapshot='{}',response=null,finished_at=now() where id=job;
 return after_count-before_count;
end $$;
create or replace function public.sot_accept_project(suggestion_id uuid, expected_updated_at timestamptz, project_name text, project_scope text) returns uuid
language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions; cid uuid; pid uuid; pname text;
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin must approve a project'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id for update;
 if not found then raise exception 'Suggestion not found'; end if;
 if s.kind<>'project' then raise exception 'Review a project suggestion'; end if;
 if s.status='accepted' then return s.result_id; end if;
 if s.status<>'pending' or s.archived_at is not null or s.updated_at is distinct from expected_updated_at then raise exception 'Suggestion changed. Refresh before approving.'; end if;
 if coalesce((s.payload#>>'{checklist,identity_resolved}')::boolean,false) is not true then raise exception 'Confirm the client relationship first'; end if;
 cid:=nullif(s.payload->>'client_id','')::uuid;
 if not exists(select 1 from public.clients where id=cid and archived_at is null) then raise exception 'An active confirmed client is required'; end if;
 pname:=btrim(project_name);
 if pname is null or length(pname) not between 1 and 160 or length(btrim(coalesce(project_scope,''))) not between 1 and 10000 then raise exception 'Project name and scope are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(cid::text||lower(pname),7));
 select id into pid from public.projects where client_id=cid and lower(btrim(name))=lower(pname) order by created_at limit 1;
 if pid is not null and exists(select 1 from public.projects where id=pid and stage='completed') then raise exception 'This project is completed. Review its scope before reusing it.'; end if;
 if pid is null then
  insert into public.projects(client_id,name,description,stage) values(cid,pname,project_scope,'planned') returning id into pid;
 end if;
 insert into public.workspace_audit(actor_id,table_name,row_id,operation,before_row,after_row) values(auth.uid(),'sot_suggestions',s.id::text,'APPROVE_PROJECT',to_jsonb(s),jsonb_build_object('project_id',pid,'name',pname,'scope',project_scope));
 update public.sot_suggestions set status='accepted',result_id=pid,title=pname,description=project_scope,
  payload=payload||jsonb_build_object('approved_scope',project_scope,'approved_name',pname),updated_at=now() where id=s.id;
 insert into public.sot_accepted(dedupe_key,kind,result_id) values(s.dedupe_key,'project',pid) on conflict(dedupe_key) do nothing;
 -- Link only this reviewer's proposals; never accept or modify official tasks here.
 update public.sot_suggestions set payload=payload||jsonb_build_object('project_id',pid,'project_match','existing','new_project_name',null,'project_proposal_key',null),updated_at=now()
 where user_id=s.user_id and kind='task' and status='pending' and archived_at is null
  and payload->>'client_id'=cid::text and payload->>'project_proposal_key'=s.dedupe_key;
 return pid;
end $$;
revoke all on function public.sot_accept_project(uuid,timestamptz,text,text) from public,anon;
grant execute on function public.sot_accept_project(uuid,timestamptz,text,text) to authenticated;

create function public.sot_project_approvals() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not is_owner_or_admin() then raise exception 'Owner or admin required';end if;
 return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('reviewer_name',p.display_name) order by s.created_at) from sot_suggestions s join profiles p on p.id=s.user_id where s.kind='project' and s.status='pending' and s.archived_at is null and s.user_id<>auth.uid()),'[]');
end $$;
revoke all on function public.sot_project_approvals() from public,anon;
grant execute on function public.sot_project_approvals() to authenticated;
-- Client requests are unassigned intake, not official tasks until staff triage.
create table public.client_requests (
 id uuid primary key,client_id uuid not null references public.clients(id),title text not null,description text not null,
 status text not null default 'pending' check(status in ('pending','accepted','dismissed')),task_id uuid references public.work_items(id),
 created_at timestamptz not null default now(),reviewed_by uuid references public.profiles(id),reviewed_at timestamptz
);
alter table public.client_requests enable row level security;
grant select on public.client_requests to authenticated;
grant all on public.client_requests to service_role;
create policy requests_read on public.client_requests for select to authenticated using(is_owner_or_admin());
create trigger audit_client_requests after insert or update on public.client_requests for each row execute function public.audit_workspace_row();
create or replace function public.submit_client_request(token text,request_id uuid,request_title text,request_description text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;begin
 select id into cid from clients where share_token=token and archived_at is null;
 if cid is null then raise exception 'Client link not found';end if;
 if request_id is null or request_title is null or length(btrim(request_title)) not between 1 and 200 or length(coalesce(request_description,''))>10000 then raise exception 'Valid request title and description required';end if;
 perform pg_advisory_xact_lock(hashtextextended(cid::text,1));
 if exists(select 1 from client_requests where id=request_id and client_id=cid) or exists(select 1 from work_items where id=request_id and client_id=cid and source='client') then return;end if;
 if (select count(*) from client_requests where client_id=cid and created_at>now()-interval '1 hour')>=20 then raise exception 'Too many requests. Please try again later.';end if;
 insert into client_requests(id,client_id,title,description) values(request_id,cid,btrim(request_title),btrim(coalesce(request_description,'')));
end $$;
create function public.review_client_request(request_id uuid, selected_project uuid, dismiss boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare r client_requests; result uuid;begin
 if not is_owner_or_admin() then raise exception 'Owner or admin required';end if;
 select * into r from client_requests where id=request_id for update;
 if not found then raise exception 'Request not found';end if;
 if r.status<>'pending' then return r.task_id;end if;
 if not dismiss then
  if not exists(select 1 from projects p join clients c on c.id=p.client_id where p.id=selected_project and p.client_id=r.client_id and not p.is_default and p.stage<>'completed' and c.archived_at is null) then raise exception 'Choose an active project for this client';end if;
  insert into work_items(client_id,project_id,title,description,source,year_month,assigned_user_id,client_visible)
   values(r.client_id,selected_project,r.title,r.description,'client',to_char(now() at time zone 'America/Los_Angeles','YYYY-MM'),auth.uid()::text,false) returning id into result;
 end if;
 update client_requests set status=case when dismiss then 'dismissed' else 'accepted' end,task_id=result,reviewed_by=auth.uid(),reviewed_at=now() where id=r.id;
 return result;
end $$;
revoke all on function public.review_client_request(uuid,uuid,boolean) from public,anon;
grant execute on function public.review_client_request(uuid,uuid,boolean) to authenticated;
create or replace function public.save_time_log(entry_id uuid, expected_updated_at timestamptz, selected_project uuid, selected_task uuid, entry_start timestamptz, entry_end timestamptz, entry_note text, entry_billable boolean, request_id uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare e public.time_entries; result uuid; preserve_history boolean:=false;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 if entry_id is not null then
  select * into e from time_entries where id=entry_id for update;
  if not found then raise exception 'Entry not found';end if;
  if e.user_id<>auth.uid()::text and not payroll_manager() then raise exception 'You can edit only your own time';end if;
  preserve_history:=e.project_id=selected_project and e.work_item_id is not distinct from selected_task;
 end if;
 if entry_start is null or entry_end is null or entry_end<=entry_start or entry_end>now()+interval '1 minute' or entry_end-entry_start>interval '24 hours' then raise exception 'Choose a valid time range up to 24 hours, ending in the past'; end if;
 if length(coalesce(entry_note,''))>4000 then raise exception 'Note is too long'; end if;
 if not preserve_history and not exists(select 1 from public.projects p join public.clients c on c.id=p.client_id where p.id=selected_project and c.archived_at is null) then raise exception 'Choose an active client project'; end if;
 if not preserve_history and selected_task is not null and not exists(select 1 from public.work_items where id=selected_task and project_id=selected_project and archived_at is null) then raise exception 'Choose a task in this project'; end if;
 if not preserve_history and selected_task is not null and exists(select 1 from public.work_items where parent_id=selected_task and archived_at is null) then raise exception 'Log time to a subtask or directly to the project'; end if;
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
create or replace function public.sot_queue_report(uid uuid) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('fetch_retries',(select count(*) from sot_fetch_retries where user_id=uid),'manually_resolved_messages',(select count(*) from sot_message_receipts where user_id=uid and review_method='manual'),'waiting',(select count(*) from sot_mail_queue where user_id=uid and status='ready'),'needs_review',(select count(*) from sot_mail_queue where user_id=uid and status='review'),'oldest',(select min(oldest_at) from sot_mail_queue where user_id=uid and status<>'done'),'review_items',(select coalesce(jsonb_agg(x),'[]') from (select * from (select thread_id,reason,oldest_at from sot_mail_queue where user_id=uid and status='review' union all select r.thread_id,'Email retrieval failed; reconnect Gmail or review and resolve.' as reason,r.first_failed_at as oldest_at from sot_fetch_retries r where r.user_id=uid and not exists(select 1 from sot_mail_queue q where q.user_id=r.user_id and q.thread_id=r.thread_id and q.status in ('ready','review'))) entries order by oldest_at limit 200)x),'reviewed_messages',(select count(*) from sot_message_receipts where user_id=uid and review_method='analysis'),'input_tokens',(select coalesce(sum(input_tokens),0) from sot_batch_jobs where user_id=uid),'output_tokens',(select coalesce(sum(output_tokens),0) from sot_batch_jobs where user_id=uid),'estimated_usd',(select coalesce(sum(estimated_usd),0) from sot_batch_jobs where user_id=uid),'unpriced_calls',(select count(*) from sot_batch_jobs where user_id=uid and status<>'prepared' and estimated_usd is null));
$$;
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
 if contact like '%@sunrosecreative.com' then contact:=null;end if;
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

commit;
