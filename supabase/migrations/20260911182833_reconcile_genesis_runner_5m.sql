-- Reconcile hosted Genesis futures PAPER runner cadence with the canonical 5m schedule.
-- This fixes environment drift observed on 2026-09-11 where production pg_cron had */15.
-- Safety: PAPER only. Does not alter LIVE/REAL_TRADING, strategy gates, TP/SL, sizing or validation.

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
