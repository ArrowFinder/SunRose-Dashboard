-- Explicitly confirmed by the owner in this conversation. No inferred contacts are imported.
begin;
do $$ declare item record; cid uuid; begin
 for item in select * from (values
 ('One Arroyo Foundation',array['ONE ARROYO'],array[]::text[]),
 ('Rose Bowl Stadium',array[]::text[],array[]::text[]),
 ('LA Times Studios',array['L.A. Times Studios','LA Times','L.A. Times','Los Angeles Times'],array['latimes.com']),
 ('Mic Drop',array['Mic Drop Karaoke','micdrop.la'],array[]::text[]),
 ('First Tee Pasadena',array['First Tee - Greater Pasadena'],array[]::text[]),
 ('Visit Pasadena',array[]::text[],array[]::text[])
 ) as x(name,aliases,domains) loop
  select id into cid from public.clients where lower(trim(name))=lower(item.name) order by created_at limit 1;
  if cid is null then insert into public.clients(name,retainer_hours_per_month) values(item.name,0) returning id into cid; end if;
  insert into public.sot_client_profiles(client_id,aliases,domains) values(cid,item.aliases,item.domains)
  on conflict(client_id) do update set
   aliases=array(select distinct a from unnest(sot_client_profiles.aliases||excluded.aliases) a),
   domains=array(select distinct d from unnest(sot_client_profiles.domains||excluded.domains) d);
 end loop;
end $$;
commit;
