begin;
create or replace function public.is_internal_user() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin','supervisor','employee'));
$$;
create or replace function public.validate_workspace_row() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='clients' then
  if length(trim(new.name))=0 or new.retainer_hours_per_month<0 then raise exception 'Client name and nonnegative retainer required'; end if;
 elsif tg_table_name='work_items' then
  if length(trim(new.title))=0 or new.estimated_hours<0 or new.actual_hours<0 or new.year_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or new.status not in ('backlog','planned','in_progress','done') or new.source not in ('internal','client')
    or new.scope_category not in ('in_scope','needs_approval','approved_overage','out_of_scope') then raise exception 'Invalid task values'; end if;
  if new.assigned_user_id is not null and not exists(select 1 from public.profiles where id::text=new.assigned_user_id and active and role in ('owner','admin','supervisor','employee')) then raise exception 'Assignee must be an active team member'; end if;
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

create table if not exists public.sot_connections (
 user_id uuid primary key references public.profiles(id), email text not null, connected_at timestamptz not null default now(),
 last_scan_at timestamptz, scan_cursor text, scan_started_at timestamptz, scanned_threads integer not null default 0
);
-- OAuth credentials are encrypted by the Edge Function and never readable by app users.
create table if not exists public.sot_credentials (
 user_id uuid primary key references public.sot_connections(user_id) on delete cascade, encrypted_refresh text not null
);
create table if not exists public.sot_oauth_states (
 state_hash text primary key, user_id uuid not null references public.profiles(id), expires_at timestamptz not null
);
create table if not exists public.sot_scan_cache (
 user_id uuid not null references public.sot_connections(user_id) on delete cascade, thread_id text not null, fingerprint text not null,
 primary key(user_id,thread_id)
);
create table if not exists public.sot_scan_locks (
 user_id uuid primary key references public.profiles(id), lease_id uuid not null, expires_at timestamptz not null
);
create table if not exists public.sot_usage (
 month text primary key, reserved_calls integer not null default 0
);
create table if not exists public.sot_suggestions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('client','task','update','complete')),
 dedupe_key text not null, title text not null, description text not null default '',
 payload jsonb not null, source_thread text not null, source_subject text not null default '',
 evidence text not null default '', status text not null default 'pending' check(status in ('pending','accepted','dismissed')),
 result_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,dedupe_key)
);
create table if not exists public.sot_accepted (
 dedupe_key text primary key, kind text not null, result_id uuid not null
);
create table if not exists public.sot_client_contacts (
 email text primary key, client_id uuid not null references public.clients(id) on delete cascade
);
create table if not exists public.sot_notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id),
 task_id uuid not null references public.work_items(id) on delete cascade, message text not null,
 created_at timestamptz not null default now(), read_at timestamptz
);
do $$ declare t text; begin
 foreach t in array array['sot_connections','sot_credentials','sot_oauth_states','sot_scan_cache','sot_scan_locks','sot_usage','sot_suggestions','sot_accepted','sot_client_contacts','sot_notifications'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.sot_connections,public.sot_suggestions,public.sot_notifications to authenticated;
drop policy if exists sot_connections_read on public.sot_connections;
create policy sot_connections_read on public.sot_connections for select to authenticated using(user_id=auth.uid() and public.is_internal_user());
drop policy if exists sot_suggestions_read on public.sot_suggestions;
create policy sot_suggestions_read on public.sot_suggestions for select to authenticated using(user_id=auth.uid() and public.is_internal_user());
drop policy if exists sot_notifications_read on public.sot_notifications;
create policy sot_notifications_read on public.sot_notifications for select to authenticated using(recipient_id=auth.uid() and public.is_internal_user());

-- Serialize scan requests; the lease also prevents overlapping scans in different tabs.
create or replace function public.sot_claim_scan(uid uuid, lease uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.sot_scan_locks(user_id,lease_id,expires_at) values(uid,lease,now()+interval '5 minutes')
 on conflict(user_id) do update set lease_id=excluded.lease_id,expires_at=excluded.expires_at where sot_scan_locks.expires_at<now();
 return found;
end; $$;
create or replace function public.sot_reserve_call() returns boolean language plpgsql security definer set search_path=public as $$
begin
 -- Hard project-wide ceiling. Each call is separately bounded by input and output limits.
 insert into public.sot_usage(month,reserved_calls) values(to_char(now() at time zone 'UTC','YYYY-MM'),1)
 on conflict(month) do update set reserved_calls=sot_usage.reserved_calls+1 where sot_usage.reserved_calls<300;
 return found;
end; $$;
revoke all on function public.sot_claim_scan(uuid,uuid),public.sot_reserve_call() from public,anon,authenticated;
grant execute on function public.sot_claim_scan(uuid,uuid),public.sot_reserve_call() to service_role;

-- Replace a thread's pending suggestions atomically when later replies change the work.
-- Accepted and dismissed decisions are never recreated by a rescan.
create or replace function public.sot_store_thread(uid uuid, thread text, fingerprint_value text, proposals jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p jsonb;
begin
 delete from public.sot_suggestions where user_id=uid and source_thread=thread and status='pending';
 for p in select * from jsonb_array_elements(proposals) loop
  insert into public.sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,source_subject,evidence)
   values(uid,p->>'kind',p->>'dedupe_key',p->>'title',p->>'description',p->'payload',thread,p->>'source_subject',p->>'evidence')
   on conflict(user_id,dedupe_key) do update set title=excluded.title,description=excluded.description,payload=excluded.payload,
    source_thread=excluded.source_thread,source_subject=excluded.source_subject,evidence=excluded.evidence,updated_at=now() where sot_suggestions.status='pending';
 end loop;
 insert into public.sot_scan_cache(user_id,thread_id,fingerprint) values(uid,thread,fingerprint_value)
 on conflict(user_id,thread_id) do update set fingerprint=excluded.fingerprint;
end; $$;
revoke all on function public.sot_store_thread(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sot_store_thread(uuid,text,text,jsonb) to service_role;

create or replace function public.sot_dismiss(suggestion_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 update public.sot_suggestions set status='dismissed',updated_at=now() where id=suggestion_id and user_id=auth.uid() and status='pending';
 if not found then raise exception 'Suggestion is no longer available'; end if;
end; $$;
create or replace function public.sot_mark_read(notification_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 update public.sot_notifications set read_at=now() where id=notification_id and recipient_id=auth.uid();
end; $$;

create or replace function public.sot_accept(suggestion_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions; cid uuid; rid uuid; pid uuid; existing public.work_items; contact text; actor_name text;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() for update;
 if not found then raise exception 'Suggestion not found'; end if;
 if s.status='accepted' then return s.result_id; end if;
 if s.status<>'pending' then raise exception 'Suggestion was dismissed'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.dedupe_key,0));
 select result_id into rid from public.sot_accepted where dedupe_key=s.dedupe_key;
 if rid is not null then
  update public.sot_suggestions set status='accepted',result_id=rid,updated_at=now() where id=s.id;
  return rid;
 end if;
 contact:=lower(trim(s.payload->>'contact_email'));
 cid:=nullif(s.payload->>'client_id','')::uuid;
 if cid is null then select client_id into cid from public.sot_client_contacts where email=contact; end if;
 if cid is null then
  select id into cid from public.clients where lower(trim(name))=lower(trim(s.payload->>'client_name')) order by created_at limit 1;
 end if;
 if s.kind='client' then
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(s.payload->>'client_name')),1));
  if cid is null then select id into cid from public.clients where lower(trim(name))=lower(trim(s.payload->>'client_name')) order by created_at limit 1; end if;
  if cid is null then
   if length(trim(coalesce(s.payload->>'client_name',''))) not between 1 and 200 then raise exception 'Client name required'; end if;
   insert into public.clients(name,retainer_hours_per_month) values(trim(s.payload->>'client_name'),0) returning id into cid;
  end if;
  if contact is not null and contact<>'' then insert into public.sot_client_contacts(email,client_id) values(contact,cid) on conflict(email) do nothing; end if;
  rid:=cid;
 else
  if cid is null or not exists(select 1 from public.clients where id=cid) then raise exception 'Add the suggested client first'; end if;
  if s.kind='task' then
   pid:=nullif(s.payload->>'parent_id','')::uuid;
   if pid is not null and not exists(select 1 from public.work_items where id=pid and client_id=cid and parent_id is null) then raise exception 'Parent task changed; review the suggestion again'; end if;
   perform pg_advisory_xact_lock(hashtextextended(cid::text||lower(trim(s.title)),2));
   select id into rid from public.work_items where client_id=cid and lower(trim(title))=lower(trim(s.title))
    and parent_id is not distinct from pid and due_date is not distinct from nullif(s.payload->>'due_date','')::date order by created_at limit 1;
   if rid is null then
   insert into public.work_items(client_id,parent_id,year_month,title,description,due_date,estimated_hours,assigned_user_id,status,client_visible)
   values(cid,pid,coalesce(nullif(left(s.payload->>'due_date',7),''),to_char(now(),'YYYY-MM')),s.title,s.description,
    nullif(s.payload->>'due_date','')::date,coalesce((s.payload->>'estimated_hours')::numeric,0),auth.uid()::text,'planned',false) returning id into rid;
   select display_name into actor_name from public.profiles where id=auth.uid();
   insert into public.sot_notifications(recipient_id,task_id,message)
    select id,rid,coalesce(actor_name,'A teammate')||' added a task from SOT: '||s.title from public.profiles where active and role in ('owner','supervisor');
   end if;
  else
   select * into existing from public.work_items where id=(s.payload->>'task_id')::uuid and client_id=cid for update;
   if not found then raise exception 'Task no longer exists'; end if;
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
 insert into public.sot_accepted(dedupe_key,kind,result_id) values(s.dedupe_key,s.kind,rid);
 update public.sot_suggestions set status='accepted',result_id=rid,updated_at=now() where id=s.id;
 return rid;
end; $$;
revoke all on function public.sot_accept(uuid),public.sot_dismiss(uuid),public.sot_mark_read(uuid) from public,anon;
grant execute on function public.sot_accept(uuid),public.sot_dismiss(uuid),public.sot_mark_read(uuid) to authenticated;
commit;
