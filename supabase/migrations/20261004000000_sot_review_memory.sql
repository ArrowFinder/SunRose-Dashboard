begin;
alter table public.sot_client_profiles add column if not exists domains text[] not null default '{}';
alter table public.sot_connections add column if not exists next_scan_at timestamptz not null default now();
alter table public.sot_connections add column if not exists last_error text;
alter table public.sot_connections add column if not exists auto_scan boolean not null default true;
alter table public.sot_suggestions add column if not exists dismissal_reason text;
create table public.sot_review_history (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 suggestion_id uuid not null, decision text not null, reason text,
 kind text not null, client_name text not null, contact_email text not null,
 title text not null, result_id uuid, reviewed_at timestamptz not null default now()
);
alter table public.sot_review_history enable row level security;
revoke all on public.sot_review_history from anon,authenticated;
grant all on public.sot_review_history to service_role;
grant select on public.sot_review_history to authenticated;
create policy sot_history_read on public.sot_review_history for select to authenticated using(user_id=auth.uid() and public.is_internal_user());
create function public.sot_record_review() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('accepted','dismissed') and old.status='pending' then
  insert into public.sot_review_history(user_id,suggestion_id,decision,reason,kind,client_name,contact_email,title,result_id)
  values(new.user_id,new.id,new.status,new.dismissal_reason,new.kind,coalesce(new.payload->>'client_name',''),lower(coalesce(new.payload->>'contact_email','')),new.title,new.result_id);
 end if;
 return new;
end; $$;
revoke all on function public.sot_record_review() from public,anon,authenticated;
create trigger sot_review_record after update of status on public.sot_suggestions for each row execute function public.sot_record_review();
-- Preserve decisions already made before review memory was introduced.
insert into public.sot_review_history(user_id,suggestion_id,decision,kind,client_name,contact_email,title,result_id,reviewed_at)
select user_id,id,status,kind,coalesce(payload->>'client_name',''),lower(coalesce(payload->>'contact_email','')),title,result_id,updated_at from public.sot_suggestions where status in ('accepted','dismissed');
create function public.sot_dismiss_with_reason(suggestion_id uuid, reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 if reason not in ('unspecified','vendor','sponsor_partner','duplicate','already_done','not_our_responsibility','not_actionable','not_client') then raise exception 'Invalid review reason'; end if;
 update public.sot_suggestions set dismissal_reason=reason,status='dismissed',updated_at=now() where id=suggestion_id and user_id=auth.uid() and status='pending';
 if not found then raise exception 'Suggestion is no longer available'; end if;
end; $$;
create function public.sot_set_auto_scan(enabled boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 update public.sot_connections set auto_scan=enabled where user_id=auth.uid();
end; $$;
revoke all on function public.sot_dismiss_with_reason(uuid,text),public.sot_set_auto_scan(boolean) from public,anon;
grant execute on function public.sot_dismiss_with_reason(uuid,text),public.sot_set_auto_scan(boolean) to authenticated;
alter table public.sot_usage add column if not exists analysis_limit integer not null default 300 check(analysis_limit between 0 and 10000);
-- Reserve both independent analysis passes atomically, preserving the workspace budget.
create function public.sot_reserve_analysis_pair() returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.sot_usage(month,reserved_calls) values(to_char(now() at time zone 'UTC','YYYY-MM'),2)
 on conflict(month) do update set reserved_calls=sot_usage.reserved_calls+2 where sot_usage.reserved_calls+2<=sot_usage.analysis_limit;
 return found;
end; $$;
revoke all on function public.sot_reserve_analysis_pair() from public,anon,authenticated;
grant execute on function public.sot_reserve_analysis_pair() to service_role;
create table public.sot_recheck_queue (
 user_id uuid not null references public.sot_connections(user_id) on delete cascade,
 thread_id text not null, created_at timestamptz not null default now(), primary key(user_id,thread_id)
);
alter table public.sot_recheck_queue enable row level security;
revoke all on public.sot_recheck_queue from public,anon,authenticated;
grant all on public.sot_recheck_queue to service_role;
create function public.sot_recheck_pending() returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 insert into public.sot_recheck_queue(user_id,thread_id)
 select distinct user_id,source_thread from public.sot_suggestions where user_id=auth.uid() and status='pending'
 on conflict do nothing;
 update public.sot_connections set next_scan_at=now(),last_error=null where user_id=auth.uid();
end; $$;
revoke all on function public.sot_recheck_pending() from public,anon;
grant execute on function public.sot_recheck_pending() to authenticated;
-- Old suggestions were generated before relationship and responsibility checks.
-- Require reassessment rather than letting their old Ready labels bypass the new rules.
alter function public.sot_accept(uuid) rename to sot_accept_reviewed;
revoke all on function public.sot_accept_reviewed(uuid) from public,anon,authenticated;
create function public.sot_accept(suggestion_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() for update;
 if not found then raise exception 'Suggestion not found'; end if;
 if s.status='pending' and coalesce(s.payload->>'analysis_version','')<>'2' then
  raise exception 'Reassess this suggestion with the updated client and responsibility checks first';
 end if;
 return public.sot_accept_reviewed(suggestion_id);
end; $$;
revoke all on function public.sot_accept(uuid) from public,anon;
grant execute on function public.sot_accept(uuid) to authenticated;
commit;
