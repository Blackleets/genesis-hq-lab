select cron.unschedule('genesis-quant-challenger-smoke')
where exists (select 1 from cron.job where jobname = 'genesis-quant-challenger-smoke');

select cron.schedule(
  'genesis-quant-challenger-smoke',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-challenger?profile=short_micro',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-genesis-runner-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')
      ),
      timeout_milliseconds := 55000
    );
  $cron$
);
