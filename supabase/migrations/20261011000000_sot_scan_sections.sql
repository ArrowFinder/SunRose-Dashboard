begin;
alter table public.sot_connections
 add column scan_listing_done boolean not null default false,
 add column queue_turn boolean not null default false,
 add column last_completed_at timestamptz,
 add column last_attempt_at timestamptz,
 add column scan_status text not null default 'idle',
 add column section_progress text,
 add column deferred_threads integer not null default 0;
update public.sot_connections set scan_status=case when last_error is not null then 'error' when scan_started_at is not null then 'running' else 'idle' end;
create table public.sot_thread_progress (
 user_id uuid not null references public.sot_connections(user_id) on delete cascade,
 thread_id text not null,
 fingerprint text not null,
 section_index integer not null default 0,
 pass_index integer not null default 0,
 candidates jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','deferred')),
 error text,
 updated_at timestamptz not null default now(),
 primary key(user_id,thread_id)
);
alter table public.sot_thread_progress enable row level security;
revoke all on public.sot_thread_progress from public,anon,authenticated;
grant all on public.sot_thread_progress to service_role;
-- Raw intermediate hypotheses remain server-only; the connection exposes aggregate progress.
create table public.sot_scan_runs (
 id uuid primary key, user_id uuid not null references public.sot_connections(user_id) on delete cascade,
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running', detail text, scanned_threads integer not null default 0
);
alter table public.sot_scan_runs enable row level security;
revoke all on public.sot_scan_runs from public,anon,authenticated;
grant all on public.sot_scan_runs to service_role;
commit;
