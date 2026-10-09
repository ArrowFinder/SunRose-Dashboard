begin;
alter table public.clients
 add column billing_type text not null default 'retainer' check(billing_type in ('hourly','retainer')),
 add column hour_limit_enabled boolean not null default false,
 add column hourly_rate numeric check(hourly_rate>=0 and hourly_rate<1000000),
 add column monthly_fee numeric check(monthly_fee>=0 and monthly_fee<1000000),
 add column overage_rate numeric check(overage_rate>=0 and overage_rate<1000000);
update public.clients set hour_limit_enabled=retainer_hours_per_month>0;
alter table public.sot_client_profiles
 add column description text not null default '' check(length(description)<=2000),
 add column services text not null default '' check(length(services)<=2000),
 add column context_notes text not null default '' check(length(context_notes)<=4000);
create function public.save_client_context(cid uuid, description_value text, services_value text, notes_value text, aliases_value text[], domains_value text[], contacts_value text[]) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_owner_or_admin() then raise exception 'Owner or admin access required'; end if;
 perform 1 from public.clients where id=cid for update;
 if not found then raise exception 'Client not found'; end if;
 if cardinality(aliases_value)>50 or cardinality(domains_value)>50 or cardinality(contacts_value)>100 then raise exception 'Too many identity entries'; end if;
 if exists(select 1 from unnest(aliases_value) a where length(trim(a))<2 or length(a)>200) then raise exception 'Alternate names must be 2–200 characters'; end if;
 if exists(select 1 from unnest(domains_value) d where d !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' or d in ('gmail.com','googlemail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com','att.net','me.com','live.com','comcast.net')) then raise exception 'Use business domains only; add personal addresses as contacts'; end if;
 if exists(select 1 from unnest(contacts_value) e where e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(e)>254) then raise exception 'Enter valid contact email addresses'; end if;
 insert into public.sot_client_profiles(client_id,description,services,context_notes,aliases,domains)
 values(cid,coalesce(description_value,''),coalesce(services_value,''),coalesce(notes_value,''),coalesce(aliases_value,'{}'),coalesce(domains_value,'{}'))
 on conflict(client_id) do update set description=excluded.description,services=excluded.services,context_notes=excluded.context_notes,aliases=excluded.aliases,domains=excluded.domains;
 delete from public.sot_client_contacts where client_id=cid;
 insert into public.sot_client_contacts(client_id,email) select cid,lower(trim(e)) from unnest(contacts_value) e group by lower(trim(e));
end; $$;
revoke all on function public.save_client_context(uuid,text,text,text,text[],text[],text[]) from public,anon;
grant execute on function public.save_client_context(uuid,text,text,text,text[],text[],text[]) to authenticated;
commit;
