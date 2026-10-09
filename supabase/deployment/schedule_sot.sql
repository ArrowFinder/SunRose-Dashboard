-- Run after setting the SAME random SOT_SCHEDULER_KEY in Edge Function secrets
-- and Vault (name: sot_scheduler_key). Never commit its value.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Tick each minute to continue bounded discovery batches; completed mailboxes are
-- eligible only every three hours. One mailbox/thread per tick controls load.
select cron.schedule('sot-email-dispatch','* * * * *',$job$
 select net.http_post(
  url := 'https://vpyddcdncjmkjlidbsdi.supabase.co/functions/v1/sot/scheduled',
  headers := jsonb_build_object('Content-Type','application/json','x-sot-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='sot_scheduler_key')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 ) where exists(select 1 from public.sot_connections c join public.profiles p on p.id=c.user_id where c.auto_scan and c.next_scan_at<=now() and p.active and p.role in ('owner','admin','supervisor','employee'));
$job$);
