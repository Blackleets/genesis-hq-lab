create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('genesis-quant-challenger')
where exists (select 1 from cron.job where jobname = 'genesis-quant-challenger');

select cron.schedule(
  'genesis-quant-challenger',
  '27 */6 * * *',
  $cron$
    select net.http_post(
      url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-challenger',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-genesis-runner-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')
      ),
      timeout_milliseconds := 55000
    );
  $cron$
);
