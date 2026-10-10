-- Standalone project review. No task, timer, billing or payroll records are changed.
begin;
alter table public.sot_suggestions drop constraint sot_suggestions_kind_check;
alter table public.sot_suggestions add constraint sot_suggestions_kind_check check(kind in ('client','project','task','update','complete'));

-- Payload edits must not accidentally resurrect intentionally archived suggestions.
create or replace function public.sot_unarchive_current() returns trigger language plpgsql set search_path=public as $$
begin return new; end $$;

create function public.sot_accept_project(suggestion_id uuid, expected_updated_at timestamptz, project_name text, project_scope text) returns uuid
language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions; cid uuid; pid uuid; pname text;
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin must approve a project'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() for update;
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

create or replace function public.sot_accept(suggestion_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() for update;
 if not found then raise exception 'Suggestion not found'; end if;
 if s.status='pending' and (s.archived_at is not null or coalesce(s.payload->>'analysis_version','') not in ('3','4')) then raise exception 'Reassess this suggestion through the current email scan first'; end if;
 if s.kind='project' then return public.sot_accept_project(s.id,s.updated_at,s.title,s.description); end if;
 return public.sot_accept_reviewed(suggestion_id);
end $$;

-- The old combined approval is retired: project approval must never create a task.
create or replace function public.sot_approve_project_and_task(suggestion_id uuid, expected_updated_at timestamptz, edited_title text, edited_description text, selected_client uuid, approved_project_name text, edited_due date, edited_estimate numeric) returns uuid
language plpgsql security definer set search_path=public as $$
begin raise exception 'Approve the separate project suggestion first, then review the task'; end $$;

-- Preserve decisions and corrections when a thread is rescanned. New evidence is
-- collected for project review, never promoted to approved project facts.
create or replace function public.sot_store_thread(uid uuid, thread text, fingerprint_value text, proposals jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p jsonb; previous public.sot_suggestions; proof jsonb; linked uuid;
begin
 for p in select * from jsonb_array_elements(proposals) order by case when value->>'kind'='project' then 0 else 1 end loop
  proof:=jsonb_build_object('thread',thread,'subject',p->>'source_subject','quote',p->>'evidence');
  select * into previous from public.sot_suggestions where user_id=uid and dedupe_key=p->>'dedupe_key' for update;
  if found then
   if previous.kind='project' and previous.status='pending' and previous.archived_at is null then
    update public.sot_suggestions set payload=payload||jsonb_build_object('supporting_sources',
     (select coalesce(jsonb_agg(v),'[]'::jsonb) from (select distinct v from jsonb_array_elements(coalesce(previous.payload->'supporting_sources','[]'::jsonb)||jsonb_build_array(proof)) v limit 12) q)),updated_at=now() where id=previous.id;
   end if;
   continue;
  end if;
  if p->>'kind'='task' and p#>>'{payload,project_proposal_key}' is not null then
   select result_id into linked from public.sot_suggestions where user_id=uid and dedupe_key=p#>>'{payload,project_proposal_key}' and kind='project' and status='accepted';
   if linked is not null and exists(select 1 from public.projects where id=linked and client_id::text=p#>>'{payload,client_id}' and stage<>'completed') then
    p:=jsonb_set(p,'{payload}',p->'payload'||jsonb_build_object('project_id',linked,'new_project_name',null,'project_match','existing','project_proposal_key',null));
   end if;
  end if;
  insert into public.sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,source_subject,evidence)
   values(uid,p->>'kind',p->>'dedupe_key',p->>'title',p->>'description',p->'payload'||jsonb_build_object('supporting_sources',jsonb_build_array(proof)),thread,p->>'source_subject',p->>'evidence') on conflict(user_id,dedupe_key) do nothing;
 end loop;
 insert into public.sot_scan_cache(user_id,thread_id,fingerprint) values(uid,thread,fingerprint_value) on conflict(user_id,thread_id) do update set fingerprint=excluded.fingerprint;
end $$;

-- Extract existing embedded proposals into independent cards without re-reading
-- mail or treating the old summaries as verified email evidence.
do $$ declare s public.sot_suggestions; k text; pname text; begin
 for s in select * from public.sot_suggestions where kind='task' and status='pending' and archived_at is null and nullif(btrim(payload->>'new_project_name'),'') is not null and payload->>'client_id' is not null loop
  pname:=btrim(s.payload->>'new_project_name');
  k:='project:'||(s.payload->>'client_id')||':'||btrim(regexp_replace(lower(pname),'[^[:alnum:]]+',' ','g'));
  insert into public.sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,source_subject,evidence)
   values(s.user_id,'project',k,pname,'Proposed scope for '||pname||'. Review the related task suggestions and source conversations to confirm what this project includes.',
    jsonb_build_object('client_id',s.payload->>'client_id','client_name',s.payload->>'client_name','contact_email',s.payload->>'contact_email','checklist',s.payload->'checklist','analysis_version',4,'uncertainty','Imported from earlier task-level proposals. Scope and dates have not yet been confirmed.','supporting_sources',jsonb_build_array(jsonb_build_object('thread',s.source_thread,'subject',s.source_subject,'quote',s.evidence))),s.source_thread,s.source_subject,s.evidence)
   on conflict(user_id,dedupe_key) do nothing;
  update public.sot_suggestions set payload=payload||jsonb_build_object('project_proposal_key',k),updated_at=now() where id=s.id;
 end loop;
 update public.sot_suggestions p set description='Proposed scope from earlier task suggestions (not yet confirmed): '||(select string_agg(t.title,'; ' order by t.title) from public.sot_suggestions t where t.user_id=p.user_id and t.kind='task' and t.status='pending' and t.archived_at is null and t.payload->>'project_proposal_key'=p.dedupe_key), payload=p.payload||jsonb_build_object('supporting_sources',
  (select jsonb_agg(x.proof) from (select distinct jsonb_build_object('thread',t.source_thread,'subject',t.source_subject,'quote',t.evidence) proof
   from public.sot_suggestions t where t.user_id=p.user_id and t.kind='task' and t.status='pending' and t.archived_at is null and t.payload->>'project_proposal_key'=p.dedupe_key limit 12) x))
 where p.kind='project' and p.status='pending' and p.payload->>'uncertainty'='Imported from earlier task-level proposals. Scope and dates have not yet been confirmed.';
end $$;
commit;
