-- Some early prototype databases already had share_token, so ADD COLUMN IF NOT
-- EXISTS did not install the default. Generate secure tokens for new clients.
alter table public.clients alter column share_token set default (gen_random_uuid()::text || gen_random_uuid()::text);
