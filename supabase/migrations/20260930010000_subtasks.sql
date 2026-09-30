begin;
alter table public.work_items add column if not exists parent_id uuid references public.work_items(id) on delete restrict;
create index if not exists work_items_parent_idx on public.work_items(parent_id);
create or replace function public.guard_task_hierarchy() returns trigger
language plpgsql security definer set search_path=public as $$
declare parent public.work_items;
begin
 if tg_op='UPDATE' and new.parent_id is distinct from old.parent_id then
  raise exception 'A task cannot be moved to another parent';
 end if;
 if new.parent_id is not null then
  if new.parent_id=new.id then raise exception 'A task cannot be its own subtask'; end if;
  select * into parent from public.work_items where id=new.parent_id for update;
  if not found or parent.client_id<>new.client_id then raise exception 'Parent and subtask must belong to the same client'; end if;
  if parent.parent_id is not null then raise exception 'Only one level of subtasks is supported'; end if;
  if tg_op='INSERT' and exists(select 1 from public.active_timers where work_item_id=parent.id) then
   raise exception 'Stop the parent clock before adding subtasks';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_task_hierarchy on public.work_items;
create trigger guard_task_hierarchy before insert or update on public.work_items for each row execute function public.guard_task_hierarchy();
create or replace function public.guard_parent_time() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.work_items where id=new.work_item_id for update;
 if exists(select 1 from public.work_items where parent_id=new.work_item_id) then
  raise exception 'Track time on a subtask instead of its parent';
 end if;
 return new;
end $$;
drop trigger if exists guard_parent_timer on public.active_timers;
create trigger guard_parent_timer before insert or update on public.active_timers for each row execute function public.guard_parent_time();
drop trigger if exists guard_parent_time_entry on public.time_entries;
create trigger guard_parent_time_entry before insert on public.time_entries for each row execute function public.guard_parent_time();
revoke all on function public.guard_task_hierarchy(), public.guard_parent_time() from public,anon,authenticated;

-- Deliberately narrow client projection. Private child details never leave the server.
create or replace function public.client_task_items(cid uuid, month text default null) returns jsonb
language sql stable security definer set search_path=public as $$
 with selected_roots as (
  select w.id from public.work_items w where w.client_id=cid and w.parent_id is null and w.client_visible
   and (month is null or w.year_month=month or exists(select 1 from public.work_items c where c.parent_id=w.id and c.year_month=month))
 ), summaries as (
  select parent_id,count(*)::int as total,count(*) filter(where status='done')::int as done,
    bool_or(status='in_progress') as running,bool_or(status='planned') as planned
  from public.work_items where client_id=cid and parent_id is not null group by parent_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'clientId',w.client_id,'yearMonth',w.year_month,
  'title',w.title,'status',case when s.total>0 then case when s.done=s.total then 'done' when s.done>0 or s.running then 'in_progress' when s.planned then 'planned' else 'backlog' end else w.status end,
  'dueDate',w.due_date,'parentId',w.parent_id,'totalSubtasks',coalesce(s.total,0),'completedSubtasks',coalesce(s.done,0)) order by w.priority,w.title),'[]'::jsonb)
 from public.work_items w left join summaries s on s.parent_id=w.id
 where w.client_id=cid and w.client_visible and (w.id in (select id from selected_roots) or w.parent_id in (select id from selected_roots));
$$;
revoke all on function public.client_task_items(uuid,text) from public,anon,authenticated;
create or replace function public.shared_client_view(token text, month text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cid uuid; cname text; items jsonb;
begin
 select id,name into cid,cname from public.clients where share_token=token;
 if not found then raise exception 'Client link not found'; end if;
 -- Strip internal client and scheduling identifiers from the anonymous projection.
 select coalesce(jsonb_agg(value-'clientId'-'yearMonth'),'[]'::jsonb) into items from jsonb_array_elements(public.client_task_items(cid,month));
 return jsonb_build_object('client',jsonb_build_object('name',cname),'items',items);
end $$;
create or replace function public.member_client_view() returns jsonb
language plpgsql security definer set search_path=public as $$
declare cid uuid; client jsonb;
begin
 select m.client_id into cid from public.client_members m join public.profiles p on p.id=m.user_id where m.user_id=auth.uid() and p.active and p.role='client';
 if not found then return null; end if;
 select jsonb_build_object('id',id,'name',name,'color',color,'createdAt',created_at) into client from public.clients where id=cid;
 return jsonb_build_object('client',client,'items',public.client_task_items(cid,null));
end $$;
commit;
