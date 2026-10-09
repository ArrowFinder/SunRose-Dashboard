begin;
alter table public.clients add column archived_at timestamptz;
alter table public.work_items add column archived_at timestamptz;
create function public.set_task_archived(task_id uuid, archived boolean) returns void language plpgsql security definer set search_path=public as $$
declare w public.work_items; stamp timestamptz:=clock_timestamp();
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin access required'; end if;
 select * into w from public.work_items where id=task_id;
 if not found then raise exception 'Task not found'; end if;
 perform 1 from public.clients where id=w.client_id for update;
 perform 1 from public.work_items where id=task_id or parent_id=task_id order by id for update;
 select * into w from public.work_items where id=task_id;
 if exists(select 1 from public.active_timers t join public.work_items x on x.id=t.work_item_id where x.id=task_id or x.parent_id=task_id) then raise exception 'Stop the running timer before archiving or restoring this task'; end if;
 if not archived and (exists(select 1 from public.clients where id=w.client_id and archived_at is not null) or exists(select 1 from public.work_items where id=w.parent_id and archived_at is not null)) then raise exception 'Restore the client and parent task first'; end if;
 if archived and w.archived_at is null then
  update public.work_items set archived_at=stamp,client_visible=false where (id=task_id or parent_id=task_id) and archived_at is null;
 elsif not archived and w.archived_at is not null then
  update public.work_items set archived_at=null,client_visible=false where id=task_id or (parent_id=task_id and archived_at=w.archived_at);
 end if;
end; $$;
create function public.set_client_archived(client_id uuid, archived boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin access required'; end if;
 perform 1 from public.clients where id=client_id for update;
 if not found then raise exception 'Client not found'; end if;
 perform 1 from public.work_items w where w.client_id=set_client_archived.client_id order by id for update;
 if exists(select 1 from public.active_timers t join public.work_items w on w.id=t.work_item_id where w.client_id=set_client_archived.client_id) then raise exception 'Stop this client''s running timers first'; end if;
 update public.clients set archived_at=case when archived then coalesce(archived_at,now()) else null end where id=client_id;
 if archived then update public.work_items w set client_visible=false where w.client_id=set_client_archived.client_id; end if;
end; $$;
revoke all on function public.set_task_archived(uuid,boolean),public.set_client_archived(uuid,boolean) from public,anon;
grant execute on function public.set_task_archived(uuid,boolean),public.set_client_archived(uuid,boolean) to authenticated;
create function public.guard_archived_work() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.clients where id=new.client_id for update;
 if (tg_op='INSERT' and new.archived_at is not null) or (tg_op='UPDATE' and new.archived_at is distinct from old.archived_at) then
  if not public.is_owner_or_admin() then raise exception 'Owner or admin access required'; end if;
 end if;
 if tg_op='INSERT' and (exists(select 1 from public.clients where id=new.client_id and archived_at is not null) or exists(select 1 from public.work_items where id=new.parent_id and archived_at is not null)) then raise exception 'Restore the client and parent before adding work'; end if;
 if new.client_visible and (new.archived_at is not null or exists(select 1 from public.clients where id=new.client_id and archived_at is not null)) then raise exception 'Archived work cannot be shared'; end if;
 return new;
end; $$;
create trigger a_guard_archived_work before insert or update on public.work_items for each row execute function public.guard_archived_work();
create function public.guard_archived_time() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.clients c join public.work_items w on w.client_id=c.id where w.id=new.work_item_id for update of c;
 perform 1 from public.work_items where id=new.work_item_id for update;
 if exists(select 1 from public.work_items w join public.clients c on c.id=w.client_id where w.id=new.work_item_id and (w.archived_at is not null or c.archived_at is not null)) then raise exception 'Restore archived work before tracking new time'; end if;
 return new;
end; $$;
create trigger a_guard_archived_timer before insert or update on public.active_timers for each row execute function public.guard_archived_time();
create trigger a_guard_archived_entry before insert on public.time_entries for each row execute function public.guard_archived_time();
create or replace function public.client_task_items(cid uuid, month text default null) returns jsonb
language sql stable security definer set search_path=public as $$
 with selected_roots as (
  select w.id from public.work_items w where w.client_id=cid and w.parent_id is null and w.client_visible and w.archived_at is null
   and (month is null or w.year_month=month or exists(select 1 from public.work_items c where c.parent_id=w.id and c.year_month=month))
 ), summaries as (
  select parent_id,count(*)::int as total,count(*) filter(where status='done')::int as done,
    bool_or(status='in_progress') as running,bool_or(status='planned') as planned
  from public.work_items where client_id=cid and archived_at is null and parent_id is not null group by parent_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'clientId',w.client_id,'yearMonth',w.year_month,
  'title',w.title,'status',case when s.total>0 then case when s.done=s.total then 'done' when s.done>0 or s.running then 'in_progress' when s.planned then 'planned' else 'backlog' end else w.status end,
  'dueDate',w.due_date,'parentId',w.parent_id,'totalSubtasks',coalesce(s.total,0),'completedSubtasks',coalesce(s.done,0)) order by w.priority,w.title),'[]'::jsonb)
 from public.work_items w left join summaries s on s.parent_id=w.id
 where w.client_id=cid and w.client_visible and w.archived_at is null and (w.id in (select id from selected_roots) or w.parent_id in (select id from selected_roots));
$$;
revoke all on function public.client_task_items(uuid,text) from public,anon,authenticated;
create or replace function public.shared_client_view(token text, month text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cid uuid; cname text; items jsonb;
begin
 select id,name into cid,cname from public.clients where share_token=token and archived_at is null;
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
 select jsonb_build_object('id',id,'name',name,'color',color,'createdAt',created_at) into client from public.clients where id=cid and archived_at is null;
 if not found then return null; end if;
 return jsonb_build_object('client',client,'items',public.client_task_items(cid,null));
end $$;

commit;
