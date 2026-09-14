do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'genesis-solana-observer-5m'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'genesis-solana-observer-5m',
  '2-57/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-solana-observer',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-genesis-runner-token',
        (select decrypted_secret
         from vault.decrypted_secrets
         where name = 'genesis_runner_token'
         limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 12000
    );
  $cron$
);
