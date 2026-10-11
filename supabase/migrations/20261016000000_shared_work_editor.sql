begin;
-- Moving a leaf task keeps its ID and time history. Parent/project constraints still apply.
create or replace function public.guard_task_hierarchy() returns trigger
language plpgsql security definer set search_path=public as $$
declare parent public.work_items;
begin
 if tg_op='UPDATE' and new.parent_id is distinct from old.parent_id then
  if exists(select 1 from active_timers where work_item_id=new.id or work_item_id=old.parent_id or work_item_id=new.parent_id) then raise exception 'Stop affected clocks before moving a task';end if;
  if new.parent_id is not null and exists(select 1 from work_items where parent_id=new.id) then raise exception 'Move existing subtasks before making this task a subtask';end if;
 end if;
 if new.parent_id is not null then
  if new.parent_id=new.id then raise exception 'A task cannot be its own subtask';end if;
  select * into parent from work_items where id=new.parent_id for update;
  if not found or parent.client_id<>new.client_id then raise exception 'Parent and subtask must belong to the same client';end if;
  if parent.parent_id is not null then raise exception 'Only one level of subtasks is supported';end if;
  if parent.archived_at is not null and (tg_op='INSERT' or new.parent_id is distinct from old.parent_id) then raise exception 'Restore the parent task first';end if;
  if (tg_op='INSERT' or new.parent_id is distinct from old.parent_id) and exists(select 1 from active_timers where work_item_id=parent.id) then raise exception 'Stop the parent clock before adding subtasks';end if;
 end if;
 return new;
end $$;
-- Category changes and acceptance are one transaction, including feedback and notifications.
create function public.sot_editor_submit(suggestion_id uuid,expected_updated_at timestamptz,editor_kind text,fields jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare s sot_suggestions; stamp timestamptz; rid uuid; target_kind text; prior uuid[]; edited_payload jsonb; cid uuid; pid uuid; parent uuid;
begin
 if not is_internal_user() then raise exception 'Staff access required';end if;
 select * into s from sot_suggestions where id=suggestion_id for update;
 if not found or (s.user_id<>auth.uid() and not(s.kind='project' and is_owner_or_admin())) then raise exception 'Suggestion not found';end if;
 if s.status='accepted' then return s.result_id;end if;
 if s.status<>'pending' or s.archived_at is not null or s.updated_at is distinct from expected_updated_at then raise exception 'Suggestion changed. Close and reopen it.';end if;
 if editor_kind is null or editor_kind not in ('client','project','task','subtask','update','complete') then raise exception 'Choose a category';end if;
 if editor_kind in ('client','project') and not is_owner_or_admin() then raise exception 'Owner or admin required';end if;
 if editor_kind in ('update','complete') and editor_kind<>s.kind then raise exception 'Only an existing update or completion can use this action';end if;
 if s.user_id<>auth.uid() and editor_kind<>'project' then raise exception 'Only the suggestion reviewer can change its category';end if;
 if fields->>'title' is null or length(btrim(fields->>'title')) not between 1 and 200 or length(coalesce(fields->>'description',''))>10000 then raise exception 'Enter a title and description under 10000 characters';end if;
 target_kind:=case when editor_kind='subtask' then 'task' else editor_kind end;
 cid:=nullif(fields->>'client_id','')::uuid;pid:=nullif(fields->>'project_id','')::uuid;parent:=case when editor_kind in ('subtask','update','complete') then nullif(fields->>'parent_id','')::uuid else null end;
 if editor_kind='subtask' and parent is null then raise exception 'Choose a parent task';end if;
 edited_payload:=s.payload||jsonb_build_object('user_edited',true,'reviewed_category',editor_kind);
 if target_kind<>s.kind then
  edited_payload:=edited_payload-'task_id'-'expected_updated_at'-'project_proposal_key';
  if target_kind='client' then edited_payload:=(edited_payload-'contact_email'-'aliases'-'website_candidate'-'website_confirmed')||jsonb_build_object('client_id',null,'client_name',fields->>'title','checklist',jsonb_build_object('identity_resolved',true),'identity_confirmed',true);end if;
 end if;
 insert into workspace_audit(actor_id,table_name,row_id,operation,before_row,after_row) values(auth.uid(),'sot_suggestions',s.id::text,'RECLASSIFY',to_jsonb(s),jsonb_build_object('kind',target_kind,'fields',fields));
 update sot_suggestions set kind=target_kind,payload=edited_payload,updated_at=clock_timestamp() where id=s.id returning updated_at into stamp;
 if target_kind='client' and s.kind<>'client' then
  rid:=review_create_client(fields->>'title',coalesce(fields->>'description',''));
  update sot_suggestions set title=btrim(fields->>'title'),description=coalesce(fields->>'description',''),status='accepted',result_id=rid,updated_at=clock_timestamp() where id=s.id;
  insert into sot_accepted(dedupe_key,kind,result_id) values(s.dedupe_key,'client',rid) on conflict(dedupe_key) do nothing;
  return rid;
 end if;
 select array_agg(id) into prior from work_items;
 rid:=sot_review_submit(s.id,stamp,fields->>'title',coalesce(fields->>'description',''),cid,pid,parent,nullif(fields->>'due_date','')::date,nullif(fields->>'estimated_hours','')::numeric,nullif(fields->>'assigned_user_id','')::uuid);
 if target_kind='project' then
  update projects set stage=coalesce(fields->>'stage','planned'),billing_type=coalesce(fields->>'billing_type','inherit'),hourly_rate=nullif(fields->>'hourly_rate','')::numeric,fee=nullif(fields->>'fee','')::numeric,hour_budget=nullif(fields->>'hour_budget','')::numeric,start_date=nullif(fields->>'start_date','')::date,due_date=nullif(fields->>'due_date','')::date where id=rid;
 elsif target_kind in ('update','complete') then
  update work_items set title=btrim(fields->>'title'),description=coalesce(fields->>'description',''),project_id=pid,parent_id=parent,assigned_user_id=nullif(fields->>'assigned_user_id',''),due_date=nullif(fields->>'due_date','')::date,estimated_hours=coalesce(nullif(fields->>'estimated_hours','')::numeric,estimated_hours),year_month=coalesce(fields->>'year_month',year_month),status=case when target_kind='complete' then 'done' else coalesce(fields->>'status',status) end,client_visible=case when is_owner_or_admin() then coalesce((fields->>'client_visible')::boolean,client_visible) else client_visible end where id=rid;
 elsif target_kind='task' and not(rid=any(coalesce(prior,'{}'::uuid[]))) then
  update work_items set year_month=coalesce(fields->>'year_month',year_month),status=coalesce(fields->>'status',status),client_visible=case when is_owner_or_admin() then coalesce((fields->>'client_visible')::boolean,false) else false end where id=rid;
 end if;
 return rid;
end $$;
revoke all on function public.sot_editor_submit(uuid,timestamptz,text,jsonb) from public,anon;
grant execute on function public.sot_editor_submit(uuid,timestamptz,text,jsonb) to authenticated;
commit;
