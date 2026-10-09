begin;
create table public.support_view_audit (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.profiles(id),
 target_id uuid not null references public.profiles(id),
 viewed_at timestamptz not null default now()
);
alter table public.support_view_audit enable row level security;
revoke all on public.support_view_audit from public,anon,authenticated;
create function public.support_user_snapshot(target_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare target public.profiles; cid uuid; cv jsonb;
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin required'; end if;
 select * into target from public.profiles where id=target_id;
 if not found then raise exception 'User not found'; end if;
 insert into public.support_view_audit(actor_id,target_id) values(auth.uid(),target.id);
 if not target.active then return jsonb_build_object('user',to_jsonb(target),'inactive',true); end if;
 if target.role='client' then
  select m.client_id into cid from public.client_members m where m.user_id=target.id;
  select jsonb_build_object('client',jsonb_build_object('id',id,'name',name,'color',color,'createdAt',created_at),'items',public.client_task_items(cid,null)) into cv from public.clients where id=cid and archived_at is null;
  return jsonb_build_object('user',to_jsonb(target),'clientView',cv);
 end if;
 return jsonb_build_object('user',to_jsonb(target),
 'connection',(select to_jsonb(c) from public.sot_connections c where c.user_id=target.id),
 'suggestions',coalesce((select jsonb_agg(s order by s.created_at desc) from (select * from public.sot_suggestions where user_id=target.id and status='pending' and archived_at is null order by created_at desc limit 200) s),'[]'::jsonb),
 'notifications',coalesce((select jsonb_agg(n order by n.created_at desc) from (select * from public.sot_notifications where recipient_id=target.id and read_at is null order by created_at desc limit 50)n),'[]'::jsonb),
 'timer',(select to_jsonb(t) from public.active_timers t where t.user_id=target.id));
end $$;
revoke all on function public.support_user_snapshot(uuid) from public,anon;
grant execute on function public.support_user_snapshot(uuid) to authenticated;
commit;
