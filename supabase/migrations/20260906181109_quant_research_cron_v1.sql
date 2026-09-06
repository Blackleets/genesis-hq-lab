-- Quant research worker: hourly, read-only market research. Secret is resolved inside Vault at runtime.
select cron.unschedule(jobid)
from cron.job
where jobname = 'genesis-quant-research-hourly';

select cron.schedule(
  'genesis-quant-research-hourly',
  '17 * * * *',
  $$
  select net.http_post(
    url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-research',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-genesis-runner-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')
    ),
    timeout_milliseconds := 55000
  );
  $$
);
