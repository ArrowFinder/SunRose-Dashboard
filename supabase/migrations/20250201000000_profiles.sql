-- SunRose Phase A: profiles + client_members + RLS
-- Run via Supabase CLI or SQL Editor after linking project.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.app_role as enum ('owner', 'admin', 'employee', 'client');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role public.app_role not null default 'employee',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Client',
  created_at timestamptz not null default now()
);

create table if not exists public.client_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists client_members_client_id_idx on public.client_members (client_id);

-- New auth user -> profile row
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(coalesce(new.email, ''), '@', 1),
      'User'
    ),
    'employee'::public.app_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_owner_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
  );
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;

drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff"
  on public.profiles for select
  using (auth.uid() = id or public.is_owner_or_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "clients_select_staff" on public.clients;
create policy "clients_select_staff"
  on public.clients for select
  using (auth.uid() is not null);

drop policy if exists "client_members_select_own_or_staff" on public.client_members;
create policy "client_members_select_own_or_staff"
  on public.client_members for select
  using (
    auth.uid() = user_id
    or public.is_owner_or_admin()
  );

-- First user promotion to owner (run manually in SQL after signup):
-- update public.profiles set role = 'owner' where id = '<your-user-uuid>';
