-- Challenger Lab v1: research-only tournaments, staggered to avoid Edge Function resource contention.
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'genesis-quant-challenger',
  'genesis-quant-challenger-bootstrap',
  'genesis-quant-challenger-short-micro',
  'genesis-quant-challenger-short-core',
  'genesis-quant-challenger-short-alt',
  'genesis-quant-challenger-long-probe'
);

select cron.schedule('genesis-quant-challenger-short-core','48 */6 * * *',$$select net.http_post(url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-challenger?profile=short_core',headers := jsonb_build_object('content-type','application/json','x-genesis-runner-token',(select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')),timeout_milliseconds := 55000);$$);
select cron.schedule('genesis-quant-challenger-short-alt','50 */6 * * *',$$select net.http_post(url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-challenger?profile=short_alt',headers := jsonb_build_object('content-type','application/json','x-genesis-runner-token',(select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')),timeout_milliseconds := 55000);$$);
select cron.schedule('genesis-quant-challenger-long-probe','52 */6 * * *',$$select net.http_post(url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-challenger?profile=long_probe',headers := jsonb_build_object('content-type','application/json','x-genesis-runner-token',(select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')),timeout_milliseconds := 55000);$$);
select cron.schedule('genesis-quant-challenger-short-micro','54 */6 * * *',$$select net.http_post(url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-quant-challenger?profile=short_micro',headers := jsonb_build_object('content-type','application/json','x-genesis-runner-token',(select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')),timeout_milliseconds := 55000);$$);
