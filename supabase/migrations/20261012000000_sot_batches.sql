begin;
alter table public.sot_usage alter column analysis_limit set default 600;
-- Collecting mail and reviewing it have separate checkpoints.
alter table public.sot_connections add column scan_report jsonb, add column collected_through timestamptz, add column collection_started timestamptz, add column collection_cursor text;
create table public.sot_mail_queue (
 user_id uuid references public.sot_connections(user_id) on delete cascade,
 thread_id text not null, fingerprint text not null, payload jsonb not null default '{}',
 status text not null check(status in ('ready','review','done')), reason text,
 oldest_at timestamptz not null, updated_at timestamptz not null default now(),
 primary key(user_id,thread_id)
);
create table public.sot_message_receipts (
 user_id uuid references public.sot_connections(user_id) on delete cascade,
 message_id text not null, reviewed_at timestamptz not null default now(), primary key(user_id,message_id)
);
create table public.sot_batch_jobs (
 id uuid primary key, user_id uuid references public.sot_connections(user_id) on delete cascade,
 status text not null check(status in ('prepared','reserved','answered','complete','review')),
 snapshot jsonb not null, response jsonb, created_at timestamptz not null default now(), finished_at timestamptz,
 input_tokens integer, cached_tokens integer, output_tokens integer, estimated_usd numeric, reason text
);
do $$ declare t text; begin foreach t in array array['sot_mail_queue','sot_message_receipts','sot_batch_jobs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;
create index on public.sot_mail_queue(user_id,status,oldest_at);
create index on public.sot_batch_jobs(user_id,status,created_at);
-- Six local-time checks; converting local timestamps handles PST/PDT automatically.
create function public.sot_next_check(at_time timestamptz default now()) returns timestamptz language sql stable as $$
 select min((date_trunc('day',at_time at time zone 'America/Los_Angeles')+d*interval '1 day'+h*interval '1 hour') at time zone 'America/Los_Angeles')
 from generate_series(0,1) d cross join unnest(array[6,9,12,15,18,21]) h
 where (date_trunc('day',at_time at time zone 'America/Los_Angeles')+d*interval '1 day'+h*interval '1 hour') at time zone 'America/Los_Angeles'>at_time;
$$;
create function public.sot_budget(at_time timestamptz default now(), manual boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare local_time timestamp:=at_time at time zone 'America/Los_Angeles'; day_start timestamptz; day_used int; recent int; used int; cap int; released int; available int; retry timestamptz;
begin
 day_start:=date_trunc('day',local_time) at time zone 'America/Los_Angeles';
 select coalesce(sum(calls),0) into day_used from sot_call_reservations where reserved_at>=day_start;
 select coalesce(sum(calls),0) into recent from sot_call_reservations where reserved_at>at_time-interval '3 hours';
 select reserved_calls,analysis_limit into used,cap from sot_usage where month=to_char(at_time at time zone 'UTC','YYYY-MM');
 used:=coalesce(used,0);cap:=coalesce(cap,600);
 released:=case when extract(hour from local_time)<6 then 0 else least(18,3*(1+floor((extract(hour from local_time)-6)/3)::int)) end;
 available:=greatest(0,least(cap-used,20-day_used,10-recent,released+case when manual then 2 else 0 end-day_used));
 retry:=sot_next_check(at_time);
 if day_used>=20 then retry:=(date_trunc('day',local_time)+interval '1 day 6 hours') at time zone 'America/Los_Angeles';end if;
 if used>=cap then retry:=greatest(retry,(date_trunc('month',at_time at time zone 'UTC')+interval '1 month') at time zone 'UTC');end if;
 return jsonb_build_object('available',available,'daily_used',day_used,'daily_limit',20,'rolling_used',recent,'rolling_limit',10,'monthly_used',used,'monthly_limit',cap,'next_check',retry,'daily_reset',(date_trunc('day',local_time)+interval '1 day') at time zone 'America/Los_Angeles');
end $$;
-- The same monthly row lock serializes all mailbox reservations. A job can be paid for once only.
create function public.sot_reserve_batch(job uuid, manual boolean default false) returns boolean language plpgsql security definer set search_path=public as $$
declare b jsonb; j public.sot_batch_jobs; monthly text:=to_char(now() at time zone 'UTC','YYYY-MM');begin
 insert into sot_usage(month,reserved_calls) values(monthly,0) on conflict do nothing;
 perform 1 from sot_usage where month=monthly for update;
 select * into j from sot_batch_jobs where id=job for update;
 if not found or j.status<>'prepared' then return false;end if;
 b:=sot_budget(now(),manual);if (b->>'available')::int<1 then return false;end if;
 insert into sot_call_reservations(calls) values(1);
 update sot_usage set reserved_calls=reserved_calls+1 where month=monthly;
 update sot_batch_jobs set status='reserved' where id=job;
 return true;
end $$;
-- Publish a validated answer, mark receipts and finish its queue entries atomically.
create function public.sot_finish_batch(job uuid, results jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare j public.sot_batch_jobs; item jsonb; mid text; before_count int; after_count int;begin
 select * into j from sot_batch_jobs where id=job for update;
 if not found then raise exception 'Batch missing';end if;
 if j.status='complete' then return 0;end if;
 if j.status<>'answered' then raise exception 'Batch has no saved answer';end if;
 select count(*) into before_count from sot_suggestions where user_id=j.user_id;
 for item in select * from jsonb_array_elements(results) loop
  if not exists(select 1 from jsonb_array_elements(j.snapshot->'threads') t where t->>'thread_id'=item->>'thread_id' and t->>'fingerprint'=item->>'fingerprint') then raise exception 'Batch source mismatch';end if;
  perform sot_store_thread(j.user_id,item->>'thread_id',item->>'fingerprint',item->'proposals');
 end loop;
 for item in select * from jsonb_array_elements(j.snapshot->'threads') loop
  for mid in select jsonb_array_elements_text(item->'message_ids') loop
   insert into sot_message_receipts(user_id,message_id) values(j.user_id,mid) on conflict do nothing;
  end loop;
  update sot_mail_queue set status='done',payload='{}',reason=null,updated_at=now() where user_id=j.user_id and thread_id=item->>'thread_id' and fingerprint=item->>'fingerprint';
 end loop;
 select count(*) into after_count from sot_suggestions where user_id=j.user_id;
 update sot_batch_jobs set status='complete',snapshot='{}',response=null,finished_at=now() where id=job;
 return after_count-before_count;
end $$;
create function public.sot_queue_report(uid uuid) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('waiting',(select count(*) from sot_mail_queue where user_id=uid and status='ready'),'needs_review',(select count(*) from sot_mail_queue where user_id=uid and status='review'),'oldest',(select min(oldest_at) from sot_mail_queue where user_id=uid and status<>'done'),'review_items',(select coalesce(jsonb_agg(x),'[]') from (select thread_id,reason,oldest_at from sot_mail_queue where user_id=uid and status='review' order by oldest_at limit 10)x),'reviewed_messages',(select count(*) from sot_message_receipts where user_id=uid),'input_tokens',(select coalesce(sum(input_tokens),0) from sot_batch_jobs where user_id=uid),'output_tokens',(select coalesce(sum(output_tokens),0) from sot_batch_jobs where user_id=uid),'estimated_usd',(select coalesce(sum(estimated_usd),0) from sot_batch_jobs where user_id=uid),'unpriced_calls',(select count(*) from sot_batch_jobs where user_id=uid and status<>'prepared' and estimated_usd is null));
$$;
revoke all on function public.sot_budget(timestamptz,boolean),public.sot_reserve_batch(uuid,boolean),public.sot_finish_batch(uuid,jsonb),public.sot_queue_report(uuid) from public,anon,authenticated;
grant execute on function public.sot_budget(timestamptz,boolean),public.sot_reserve_batch(uuid,boolean),public.sot_finish_batch(uuid,jsonb),public.sot_queue_report(uuid) to service_role;
-- Old section bookkeeping is retained for recovery; the new engine does not use its cursor.
update public.sot_connections set next_scan_at=public.sot_next_check(),section_progress=null,scan_status='scheduled' where auto_scan;
commit;
