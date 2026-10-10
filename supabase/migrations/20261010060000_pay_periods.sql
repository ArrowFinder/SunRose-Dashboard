begin;
-- Pay rates never enter the broadly readable staff profile or time-entry tables.
create table public.staff_pay_rates (
 user_id uuid primary key references public.profiles(id),
 hourly_rate numeric(12,2) not null check(hourly_rate>=0 and hourly_rate<=100000),
 currency text not null default 'USD' check(currency ~ '^[A-Z]{3}$'),
 updated_at timestamptz not null default now()
);
create table public.pay_periods (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 starts_on date not null, ends_on date not null, timezone text not null,
 starts_at timestamptz not null, ends_at timestamptz not null,
 cadence text not null check(cadence in ('weekly','biweekly','semimonthly','monthly','custom')),
 status text not null default 'draft' check(status in ('draft','submitted','approved','locked','cancelled')),
 hourly_rate numeric(12,2), currency text not null default 'USD',
 minutes numeric not null default 0, entry_snapshot jsonb not null default '[]',
 reviewed_by uuid references public.profiles(id), note text not null default '',
 updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
 check(ends_on>=starts_on and ends_on-starts_on<=62), check(ends_at>starts_at)
);
alter table public.staff_pay_rates enable row level security;
alter table public.pay_periods enable row level security;
revoke all on public.staff_pay_rates,public.pay_periods from public,anon,authenticated;
create trigger audit_staff_pay_rates after insert or update or delete on public.staff_pay_rates for each row execute function public.audit_workspace_row();
create trigger audit_pay_periods after insert or update or delete on public.pay_periods for each row execute function public.audit_workspace_row();

create function public.payroll_manager() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin','supervisor'));
$$;
create function public.set_staff_pay_rate(member uuid, rate numeric, currency_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin access required'; end if;
 if not exists(select 1 from public.profiles where id=member and active and role<>'client') then raise exception 'Choose an active staff member'; end if;
 if rate is null or rate<0 or rate>100000 or currency_code is null or currency_code !~ '^[A-Z]{3}$' then raise exception 'Enter a valid rate and three-letter currency'; end if;
 insert into public.staff_pay_rates(user_id,hourly_rate,currency) values(member,rate,currency_code)
 on conflict(user_id) do update set hourly_rate=excluded.hourly_rate,currency=excluded.currency,updated_at=clock_timestamp();
end $$;
create function public.payroll_data() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 return jsonb_build_object('rates',case when public.is_owner_or_admin() then (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.staff_pay_rates r) else '[]'::jsonb end,
 'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'user_id',p.user_id,'starts_on',p.starts_on,'ends_on',p.ends_on,'timezone',p.timezone,'cadence',p.cadence,'status',p.status,'minutes',p.minutes,'hourly_rate',case when public.is_owner_or_admin() then p.hourly_rate end,'currency',case when public.is_owner_or_admin() then p.currency end,'updated_at',p.updated_at,'note',p.note,'reviewed_by',p.reviewed_by) order by p.starts_on desc),'[]') from public.pay_periods p where p.user_id=auth.uid() or public.payroll_manager()));
end $$;
create function public.create_pay_period(member uuid, first_day date, last_day date, zone text, frequency text) returns uuid language plpgsql security definer set search_path=public as $$
declare rid uuid;
begin
 if not public.payroll_manager() then raise exception 'Owner, admin or supervisor access required'; end if;
 if not exists(select 1 from public.profiles where id=member and active and role<>'client') then raise exception 'Choose an active staff member'; end if;
 if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Choose a valid timezone'; end if;
 if first_day is null or last_day is null or last_day<first_day or last_day-first_day>62 then raise exception 'Choose a period up to 63 days'; end if;
 perform pg_advisory_xact_lock(hashtextextended(member::text,11));
 if exists(select 1 from public.pay_periods where user_id=member and status<>'cancelled' and starts_at<(last_day+1)::timestamp at time zone zone and ends_at>first_day::timestamp at time zone zone) then raise exception 'This person already has an overlapping pay period'; end if;
 insert into public.pay_periods(user_id,starts_on,ends_on,timezone,starts_at,ends_at,cadence,hourly_rate,currency)
 values(member,first_day,last_day,zone,first_day::timestamp at time zone zone,(last_day+1)::timestamp at time zone zone,frequency,(select hourly_rate from public.staff_pay_rates where user_id=member),coalesce((select currency from public.staff_pay_rates where user_id=member),'USD')) returning id into rid;
 return rid;
end $$;
-- Every write path, including the legacy correction/void RPCs, observes the lock.
create function public.guard_pay_period_time() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,11));
 if exists(select 1 from public.pay_periods p where p.user_id::text=new.user_id::text and p.status in ('submitted','approved','locked') and (p.starts_at<new.ended_at or new.started_at=new.ended_at and new.started_at>=p.starts_at) and p.ends_at>new.started_at) then raise exception 'This time is in a submitted, approved or locked period. Return the period for correction first.'; end if;
 if tg_op='UPDATE' then
  if exists(select 1 from public.pay_periods p where p.user_id::text=old.user_id::text and p.status in ('submitted','approved','locked') and (p.starts_at<old.ended_at or old.started_at=old.ended_at and old.started_at>=p.starts_at) and p.ends_at>old.started_at) then raise exception 'The original entry is in a protected pay period'; end if;
 end if;
 return new;
end $$;
create trigger c_pay_period_time before insert or update on public.time_entries for each row execute function public.guard_pay_period_time();
create function public.change_pay_period(period_id uuid, expected_updated_at timestamptz, action text, reason text default '') returns void language plpgsql security definer set search_path=public as $$
declare p public.pay_periods; member uuid; amount numeric; snapshot jsonb;
begin
 if not public.is_internal_user() then raise exception 'Staff access required'; end if;
 select user_id into member from public.pay_periods where id=period_id;
 if member is null or (member<>auth.uid() and not public.payroll_manager()) then raise exception 'Period not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(member::text,11));
 select * into p from public.pay_periods where id=period_id for update;
 if p.updated_at is distinct from expected_updated_at then raise exception 'Period changed. Refresh before continuing'; end if;
 if action='submit' then
  if p.status<>'draft' then raise exception 'Only a draft can be submitted'; end if;
  if clock_timestamp()<p.ends_at then raise exception 'The period must end before submission'; end if;
  if exists(select 1 from public.active_timers where user_id=p.user_id and started_at<p.ends_at) then raise exception 'Stop the running timer before submitting'; end if;
  if exists(select 1 from public.time_entries a join public.time_entries b on a.id<b.id and a.user_id=b.user_id and a.started_at<b.ended_at and a.ended_at>b.started_at where a.user_id=p.user_id::text and a.voided_at is null and b.voided_at is null and greatest(a.started_at,b.started_at,p.starts_at)<least(a.ended_at,b.ended_at,p.ends_at)) then raise exception 'Resolve overlapping time entries before submission'; end if;
  select coalesce(sum(case when e.ended_at=e.started_at then e.duration_minutes else e.duration_minutes*extract(epoch from(least(e.ended_at,p.ends_at)-greatest(e.started_at,p.starts_at)))/nullif(extract(epoch from(e.ended_at-e.started_at)),0) end),0),coalesce(jsonb_agg(jsonb_build_object('id',e.id,'updated_at',e.updated_at,'started_at',e.started_at,'ended_at',e.ended_at,'duration_minutes',e.duration_minutes,'project_id',e.project_id,'work_item_id',e.work_item_id)),'[]') into amount,snapshot
   from public.time_entries e where e.user_id=p.user_id::text and e.voided_at is null and e.started_at<p.ends_at and (e.ended_at>p.starts_at or e.ended_at=e.started_at and e.started_at>=p.starts_at);
  update public.pay_periods set status='submitted',minutes=amount,entry_snapshot=snapshot,reviewed_by=null,updated_at=clock_timestamp() where id=p.id;
 elsif action='approve' then
  if not public.payroll_manager() or p.status<>'submitted' then raise exception 'A manager must approve a submitted period'; end if;
  if p.user_id=auth.uid() and not public.is_owner_or_admin() then raise exception 'Ask another manager to approve your period'; end if;
  update public.pay_periods set status='approved',reviewed_by=auth.uid(),updated_at=clock_timestamp() where id=p.id;
 elsif action='lock' then
  if not public.is_owner_or_admin() or p.status<>'approved' then raise exception 'Owner/admin can lock approved periods'; end if;
  if p.hourly_rate is null then raise exception 'Set a pay rate before locking'; end if;
  update public.pay_periods set status='locked',updated_at=clock_timestamp() where id=p.id;
 elsif action='return' then
  if not public.payroll_manager() or p.status in ('draft','cancelled') or (p.status='locked' and not public.is_owner_or_admin()) then raise exception 'A manager must return the period; only Owner/Admin can reopen locked periods'; end if;
  if length(btrim(coalesce(reason,'')))<3 then raise exception 'Give a reason for returning the period'; end if;
  update public.pay_periods set status='draft',note=btrim(reason),reviewed_by=null,minutes=0,entry_snapshot='[]',updated_at=clock_timestamp() where id=p.id;
 elsif action='cancel' then
  if not public.payroll_manager() or p.status<>'draft' then raise exception 'Only a draft period can be cancelled by a manager'; end if;
  update public.pay_periods set status='cancelled',updated_at=clock_timestamp() where id=p.id;
 elsif action='refresh_rate' then
  if not public.is_owner_or_admin() or p.status<>'draft' then raise exception 'Owner/admin can update a draft period rate'; end if;
  update public.pay_periods set hourly_rate=(select hourly_rate from public.staff_pay_rates where user_id=p.user_id),currency=coalesce((select currency from public.staff_pay_rates where user_id=p.user_id),'USD'),updated_at=clock_timestamp() where id=p.id;
 else raise exception 'Unknown period action';
 end if;
end $$;
revoke all on function public.guard_pay_period_time(),public.payroll_manager() from public,anon,authenticated;
revoke all on function public.set_staff_pay_rate(uuid,numeric,text),public.payroll_data(),public.create_pay_period(uuid,date,date,text,text),public.change_pay_period(uuid,timestamptz,text,text) from public,anon;
grant execute on function public.set_staff_pay_rate(uuid,numeric,text),public.payroll_data(),public.create_pay_period(uuid,date,date,text,text),public.change_pay_period(uuid,timestamptz,text,text) to authenticated;
commit;
