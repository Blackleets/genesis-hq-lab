-- Reliable Supabase-native trigger for the hosted futures runner heartbeat.
--
-- WHY: The public dashboard reads `external_runner_heartbeat` (via the
-- genesis-fallback edge fn) and flags the runner as STALLED when it is older
-- than 10 minutes. That heartbeat was only refreshed by the GitHub Actions cron
-- (`.github/workflows/futures-hosted-runner.yml`, schedule `*/5`). GitHub's
-- scheduled workflows are best-effort: in practice this one fired every 1-4h,
-- so the dashboard showed "runner estancado" almost continuously even though
-- the edge runner itself was healthy.
--
-- FIX: pg_cron fires from inside Postgres, on time. Every 5 minutes it POSTs to
-- the genesis-runner edge function (which self-throttles via MIN_INTERVAL_MS and
-- writes the heartbeat). This keeps `external_runner_heartbeat` well inside the
-- 10-minute window without depending on GitHub. The GitHub workflow can stay as
-- a redundant backup — the edge fn dedupes overlapping calls.
--
-- HOW TO APPLY (Supabase SQL editor, once):
--   1. Store the runner token in Vault. Use the SAME value as the
--      GENESIS_RUNNER_TOKEN GitHub secret / edge-function env var:
--
--        select vault.create_secret('<PASTE_GENESIS_RUNNER_TOKEN>', 'genesis_runner_token');
--
--   2. Run the rest of this file. It is idempotent — safe to re-run.
--
--   3. Verify:  select * from cron.job where jobname = 'genesis-runner-tick';
--               select * from cron.job_run_details order by start_time desc limit 5;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior version of the job before (re)creating it.
select cron.unschedule('genesis-runner-tick')
where exists (select 1 from cron.job where jobname = 'genesis-runner-tick');

select cron.schedule(
  'genesis-runner-tick',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-runner',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-genesis-runner-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'genesis_runner_token')
    ),
    timeout_milliseconds := 8000
  );
  $cron$
);
