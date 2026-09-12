-- Hosted Genesis futures paper runner schedule.
-- The token stays in Supabase Vault; this migration never embeds the secret.
-- LIVE execution is not enabled by this migration.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('genesis-runner-tick')
where exists (select 1 from cron.job where jobname = 'genesis-runner-tick');

select cron.schedule(
  'genesis-runner-tick',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-futures-runner',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-genesis-runner-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')
      ),
      timeout_milliseconds := 12000
    );
  $cron$
);
