begin;
create table public.sot_spending_settings (
 singleton boolean primary key default true check(singleton),
 monthly_limit_usd numeric not null default 15 check(monthly_limit_usd>0),
 warning_usd numeric not null default 10 check(warning_usd>=0 and warning_usd<monthly_limit_usd),
 window_limit_usd numeric not null default 1 check(window_limit_usd>=0.50),
 activated_at timestamptz not null default now()
);
insert into public.sot_spending_settings default values;
alter table public.sot_spending_settings enable row level security;
revoke all on public.sot_spending_settings from public,anon,authenticated;
-- Cost holds survive failures and missing usage reports. Paid-call counters remain diagnostic only.
alter table public.sot_batch_jobs add column budget_reserved_at timestamptz,add column budget_hold_usd numeric check(budget_hold_usd>=0);
create or replace function public.sot_budget(at_time timestamptz default now(), manual boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare cfg public.sot_spending_settings; local_time timestamp:=at_time at time zone 'America/Los_Angeles'; month_start timestamptz; window_start timestamptz; monthly_cost numeric; monthly_hold numeric; window_cost numeric; used int; missing int; available int; retry timestamptz; why text;
begin
 select * into strict cfg from public.sot_spending_settings;
 month_start:=date_trunc('month',at_time at time zone 'UTC') at time zone 'UTC';
 select max((date_trunc('day',local_time)+d*interval '1 day'+h*interval '1 hour') at time zone 'America/Los_Angeles') into window_start
 from generate_series(-1,0) d cross join unnest(array[6,9,12,15,18,21]) h
 where (date_trunc('day',local_time)+d*interval '1 day'+h*interval '1 hour') at time zone 'America/Los_Angeles'<=at_time;
 select coalesce(sum(estimated_usd),0),coalesce(sum(case when estimated_usd is null then coalesce(budget_hold_usd,0) else 0 end),0),count(*) filter(where estimated_usd is null and budget_hold_usd is null)
 into monthly_cost,monthly_hold,missing from public.sot_batch_jobs
 where coalesce(budget_reserved_at,created_at)>=month_start and coalesce(budget_reserved_at,created_at)<=at_time and status<>'prepared';
 select coalesce(sum(coalesce(estimated_usd,budget_hold_usd,0)),0) into window_cost from public.sot_batch_jobs where coalesce(budget_reserved_at,created_at)>=window_start and coalesce(budget_reserved_at,created_at)<=at_time and status<>'prepared';
 select coalesce(reserved_calls,0) into used from public.sot_usage where month=to_char(at_time at time zone 'UTC','YYYY-MM');
 retry:=public.sot_next_check(at_time);
 -- $0.50 exceeds the maximum GPT-4.1-mini context + 6,000 output token charge.
 available:=case when least(cfg.monthly_limit_usd-monthly_cost-monthly_hold,cfg.window_limit_usd-window_cost)>=0.50 then 1 else 0 end;
 if cfg.monthly_limit_usd-monthly_cost-monthly_hold<0.50 then why:='monthly_budget';retry:=(date_trunc('month',at_time at time zone 'UTC')+interval '1 month') at time zone 'UTC';
 elsif cfg.window_limit_usd-window_cost<0.50 then why:='scan_budget';
 elsif not manual and extract(hour from local_time)<6 then available:=0;why:='quiet_hours';end if;
 return jsonb_build_object('available',available,'mode','usd','monthly_cost_usd',monthly_cost,'monthly_reserved_usd',monthly_hold,'monthly_limit_usd',cfg.monthly_limit_usd,'warning_usd',cfg.warning_usd,'warning_reached',monthly_cost+monthly_hold>=cfg.warning_usd,'window_cost_usd',window_cost,'window_limit_usd',cfg.window_limit_usd,'window_start',window_start,'reservation_usd',0.50,'legacy_unpriced_calls',missing,'monthly_used',coalesce(used,0),'next_check',retry,'pause_reason',why);
end $$;
create or replace function public.sot_reserve_batch(job uuid, manual boolean default false) returns boolean language plpgsql security definer set search_path=public as $$
declare b jsonb; j public.sot_batch_jobs; monthly text:=to_char(now() at time zone 'UTC','YYYY-MM');begin
 insert into public.sot_usage(month,reserved_calls) values(monthly,0) on conflict do nothing;
 perform 1 from public.sot_usage where month=monthly for update;
 select * into j from public.sot_batch_jobs where id=job for update;
 if not found or j.status<>'prepared' then return false;end if;
 b:=public.sot_budget(now(),manual);if (b->>'available')::int<1 then return false;end if;
 insert into public.sot_call_reservations(calls) values(1);
 update public.sot_usage set reserved_calls=reserved_calls+1 where month=monthly;
 update public.sot_batch_jobs set status='reserved',budget_reserved_at=now(),budget_hold_usd=0.50 where id=job;
 return true;
end $$;
revoke all on function public.sot_budget(timestamptz,boolean),public.sot_reserve_batch(uuid,boolean) from public,anon,authenticated;
grant execute on function public.sot_budget(timestamptz,boolean),public.sot_reserve_batch(uuid,boolean) to service_role;
commit;
