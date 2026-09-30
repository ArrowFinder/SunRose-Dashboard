begin;
-- Names are required for new accounts; existing profiles are preserved.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare chosen_name text := btrim(new.raw_user_meta_data->>'display_name');
begin
 if chosen_name is null or length(chosen_name) not between 1 and 100 then raise exception 'Enter your name (up to 100 characters)'; end if;
 insert into public.profiles(id,display_name,role) values(new.id,chosen_name,'client') on conflict(id) do nothing;
 return new;
end; $$;

create or replace function public.update_my_name(new_name text) returns void language plpgsql security definer set search_path=public as $$
begin
 if new_name is null or length(btrim(new_name)) not between 1 and 100 then raise exception 'Enter your name (up to 100 characters)'; end if;
 update public.profiles set display_name=btrim(new_name),updated_at=now() where id=auth.uid() and active;
 if not found then raise exception 'Active account required'; end if;
end; $$;
revoke all on function public.update_my_name(text) from public,anon;
grant execute on function public.update_my_name(text) to authenticated;

create or replace function public.manage_member(member_id uuid, member_role public.app_role, member_name text, member_active boolean, member_client_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare actor_role public.app_role; target_role public.app_role;
begin
 select role into actor_role from public.profiles where id=auth.uid() and active;
 if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Owner or admin required'; end if;
 select role into target_role from public.profiles where id=member_id for update;
 if not found then raise exception 'Account not found'; end if;
 if member_id=auth.uid() then raise exception 'You cannot change your own access'; end if;
 if member_name is null or length(btrim(member_name)) not between 1 and 100 then raise exception 'Enter a name (up to 100 characters)'; end if;
 if not member_active and exists(select 1 from public.active_timers where user_id=member_id) then raise exception 'Stop this member''s timer before deactivating the account'; end if;
 if member_role='client' and member_client_id is null then raise exception 'Select a client'; end if;
 update public.profiles set role=member_role, display_name=trim(member_name), active=member_active, updated_at=now() where id=member_id;
 delete from public.client_members where user_id=member_id;
 if member_role='client' then insert into public.client_members(user_id,client_id) values(member_id,member_client_id); end if;
end; $$;

-- Employees may work on shared tasks but cannot change what clients see.
create or replace function public.guard_client_visibility() returns trigger language plpgsql set search_path=public as $$
begin
 if public.is_internal_user() and not public.is_owner_or_admin() then
  if (tg_op='INSERT' and new.client_visible) or (tg_op='UPDATE' and new.client_visible is distinct from old.client_visible) then
   raise exception 'Only an owner or admin can change client visibility';
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists guard_client_visibility on public.work_items;
create trigger guard_client_visibility before insert or update on public.work_items for each row execute function public.guard_client_visibility();
revoke all on function public.guard_client_visibility() from public,anon,authenticated;
commit;
