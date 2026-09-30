begin;
alter table public.sot_client_contacts drop constraint if exists sot_client_contacts_pkey;
alter table public.sot_client_contacts add primary key(email,client_id);
create table if not exists public.sot_client_profiles (
 client_id uuid primary key references public.clients(id) on delete cascade,
 aliases text[] not null default '{}',location text,business_type text,
 website_url text check(website_url is null or website_url ~ '^https?://[^[:space:]]+$'),website_sources jsonb not null default '[]'
);
alter table public.sot_client_profiles enable row level security;
revoke all on public.sot_client_profiles from anon,authenticated;
grant all on public.sot_client_profiles to service_role;
grant select on public.sot_client_profiles,public.sot_client_contacts to authenticated;
drop policy if exists sot_profiles_read on public.sot_client_profiles;
create policy sot_profiles_read on public.sot_client_profiles for select to authenticated using(public.is_internal_user());
drop policy if exists sot_contacts_read on public.sot_client_contacts;
create policy sot_contacts_read on public.sot_client_contacts for select to authenticated using(public.is_internal_user());
alter table public.sot_usage add column if not exists website_searches integer not null default 0;
create or replace function public.sot_reserve_website_search() returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.sot_usage(month,website_searches) values(to_char(now() at time zone 'UTC','YYYY-MM'),1)
 on conflict(month) do update set website_searches=sot_usage.website_searches+1 where sot_usage.website_searches<40;
 return found;
end; $$;
revoke all on function public.sot_reserve_website_search() from public,anon,authenticated;
grant execute on function public.sot_reserve_website_search() to service_role;

create or replace function public.sot_confirm_identity(suggestion_id uuid, selected_client uuid, separate_business boolean, confirm_relationship boolean) returns void language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions; checklist jsonb; chosen_name text;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'Pending suggestion not found'; end if;
 if selected_client is not null and separate_business then raise exception 'Choose one business'; end if;
 if selected_client is null and not separate_business then raise exception 'Choose an existing client or confirm a separate business'; end if;
 if selected_client is not null then
  select name into chosen_name from public.clients where id=selected_client;
  if not found then raise exception 'Client not found'; end if;
 end if;
 if length(trim(coalesce(s.payload->>'client_name',''))) =0 or length(trim(coalesce(s.payload->>'contact_email','')))=0 then raise exception 'Business name and email are required'; end if;
 checklist:=coalesce(s.payload->'checklist','{}')||jsonb_build_object('business_name',true,'contact_email',true,'existing_clients_checked',true,'identity_resolved',true);
 if confirm_relationship then checklist:=checklist||jsonb_build_object('relationship_evidence',true,'relationship_confirmed_by_user',true); end if;
 checklist:=checklist||jsonb_build_object('ready',coalesce((checklist->>'relationship_evidence')::boolean,false));
 update public.sot_suggestions set dedupe_key=s.dedupe_key||':identity:'||coalesce(selected_client::text,lower(trim(s.payload->>'client_name'))),payload=s.payload||jsonb_build_object('client_id',selected_client,'identity_confirmed',true,'checklist',checklist,
  'client_name',coalesce(chosen_name,s.payload->>'client_name'),
  'website_candidate',case when chosen_name is not null and chosen_name is distinct from s.payload->>'client_name' then null else s.payload->'website_candidate' end,
  'website_confirmed',case when chosen_name is not null and chosen_name is distinct from s.payload->>'client_name' then false else coalesce((s.payload->>'website_confirmed')::boolean,false) end),updated_at=now() where id=s.id;
end; $$;
create or replace function public.sot_confirm_website(suggestion_id uuid, use_website boolean) returns void language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() and status='pending' and kind='client' for update;
 if not found then raise exception 'Pending client suggestion not found'; end if;
 if use_website and (coalesce(s.payload#>>'{website_candidate,url}','')!~'^https?://' or jsonb_array_length(coalesce(s.payload#>'{website_candidate,sources}','[]'))=0) then raise exception 'Search for a supported website first'; end if;
 update public.sot_suggestions set payload=s.payload||jsonb_build_object('website_confirmed',use_website),updated_at=now() where id=s.id;
end; $$;
revoke all on function public.sot_confirm_identity(uuid,uuid,boolean,boolean),public.sot_confirm_website(uuid,boolean) from public,anon;
grant execute on function public.sot_confirm_identity(uuid,uuid,boolean,boolean),public.sot_confirm_website(uuid,boolean) to authenticated;
create or replace function public.sot_accept(suggestion_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions; cid uuid; rid uuid; pid uuid; existing public.work_items; contact text; actor_name text;
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
   if length(trim(coalesce(s.payload->>'client_name',''))) not between 1 and 200 then raise exception 'Client name required'; end if;
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
 if cid is not null and contact is not null and contact<>'' then insert into public.sot_client_contacts(email,client_id) values(contact,cid) on conflict(email,client_id) do nothing; end if;
 insert into public.sot_accepted(dedupe_key,kind,result_id) values(s.dedupe_key,s.kind,rid) on conflict(dedupe_key) do nothing;
 update public.sot_suggestions set status='accepted',result_id=rid,updated_at=now() where id=s.id;
 return rid;
end; $$;
commit;
