-- Preserve suggestions but require a real client selection for unmatched tasks.
update public.sot_suggestions s set payload=jsonb_set(s.payload,'{checklist}',
 coalesce(s.payload->'checklist','{}')||jsonb_build_object('ready',false,'identity_resolved',false,'explanation','The client for this task is not confirmed. Select the existing client that owns this work.'))
where s.status='pending' and s.archived_at is null and s.kind<>'client'
 and s.payload->>'client_id' is null
 and not exists(select 1 from public.clients c where lower(trim(c.name))=lower(trim(s.payload->>'client_name')));
