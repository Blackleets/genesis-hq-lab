do $$
begin
  if exists (select 1 from cron.job where jobname = 'genesis-futures-native-evidence') then
    perform cron.unschedule('genesis-futures-native-evidence');
  end if;
end $$;

select cron.schedule(
  'genesis-futures-native-evidence',
  '3,18,33,48 * * * *',
  $job$
  select net.http_post(
    url := 'https://swgixcbwyhxttnmrglbk.supabase.co/functions/v1/genesis-futures-market-evidence',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-genesis-runner-token',(select decrypted_secret from vault.decrypted_secrets where name='genesis_runner_token' limit 1)
    ),
    body := jsonb_build_object('symbols',jsonb_build_array('BTCUSDT','ETHUSDT','SOLUSDT'))
  );
  $job$
);
