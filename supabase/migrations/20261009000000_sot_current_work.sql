begin;
alter table public.sot_connections add column scan_floor timestamptz not null default (now()-interval '7 days');
alter table public.sot_suggestions add column archived_at timestamptz;
-- Keep history without teaching the engine that unreviewed suggestions were rejected.
update public.sot_suggestions set archived_at=now() where status='pending';
delete from public.sot_recheck_queue;
update public.sot_connections set auto_scan=false,scan_cursor=null,scan_started_at=null,last_scan_at=null,scanned_threads=0,last_error=null,next_scan_at=now();
create table public.sot_call_reservations (
 id bigint generated always as identity primary key,
 reserved_at timestamptz not null default now(), calls integer not null check(calls between 1 and 2)
);
alter table public.sot_call_reservations enable row level security;
revoke all on public.sot_call_reservations from public,anon,authenticated;
create function public.sot_reserve_current_calls(calls integer) returns boolean language plpgsql security definer set search_path=public as $$
declare used integer; cap integer; monthly text:=to_char(now() at time zone 'UTC','YYYY-MM');
begin
 if calls is null or calls not between 1 and 2 then raise exception 'Invalid call count'; end if;
 insert into public.sot_usage(month,reserved_calls) values(monthly,0) on conflict do nothing;
 select reserved_calls,analysis_limit into used,cap from public.sot_usage where month=monthly for update;
 if used+calls>cap then return false; end if;
 if (select coalesce(sum(r.calls),0) from public.sot_call_reservations r where reserved_at>now()-interval '3 hours')+calls>10 then return false; end if;
 if (select coalesce(sum(r.calls),0) from public.sot_call_reservations r where reserved_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+calls>20 then return false; end if;
 insert into public.sot_call_reservations(calls) values(calls);
 update public.sot_usage set reserved_calls=reserved_calls+calls where month=monthly;
 return true;
end; $$;
revoke all on function public.sot_reserve_current_calls(integer) from public,anon,authenticated;
grant execute on function public.sot_reserve_current_calls(integer) to service_role;
-- Historical rechecks cannot refill the retired discovery queue.
create or replace function public.sot_recheck_pending() returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 raise exception 'Historical reassessment is retired. Use Scan recent emails.';
end; $$;
create or replace function public.sot_accept(suggestion_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.sot_suggestions;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select * into s from public.sot_suggestions where id=suggestion_id and user_id=auth.uid() for update;
 if not found then raise exception 'Suggestion not found'; end if;
 if s.status='pending' and (s.archived_at is not null or coalesce(s.payload->>'analysis_version','')<>'3') then
  raise exception 'Reassess this suggestion through the current email scan first';
 end if;
 return public.sot_accept_reviewed(suggestion_id);
end; $$;
-- Resurfacing the same proposal in current email makes it visible again.
create function public.sot_unarchive_current() returns trigger language plpgsql set search_path=public as $$
begin
 if new.payload->>'analysis_version'='3' and new.status='pending' then new.archived_at=null; end if;
 return new;
end; $$;
create trigger sot_current_visible before insert or update of payload on public.sot_suggestions for each row execute function public.sot_unarchive_current();
commit;
