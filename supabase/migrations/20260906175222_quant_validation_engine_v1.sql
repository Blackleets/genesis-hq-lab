-- Genesis Quant Validation Engine v1
-- Durable strategy versions + clean cohort attribution. PAPER only; no live execution path.

alter table public.trades add column if not exists strategy_version_id text;
alter table public.trades add column if not exists entry_regime text;
alter table public.trades add column if not exists entry_session text;
alter table public.trades add column if not exists runner_version text;
alter table public.trades add column if not exists validation_status text;

create index if not exists idx_trades_strategy_version on public.trades(strategy_version_id);
create index if not exists idx_trades_regime on public.trades(entry_regime);
create index if not exists idx_trades_session on public.trades(entry_session);

create table if not exists public.strategy_versions (
  id text primary key,
  strategy_id text not null,
  profile_id text not null,
  version text not null,
  trade_type text not null,
  status text not null default 'EXPERIMENT',
  params jsonb not null default '{}'::jsonb,
  parent_version_id text null references public.strategy_versions(id),
  source text not null default 'genesis_quant_validation_engine',
  created_at timestamptz not null default now(),
  activated_at timestamptz null,
  retired_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique(strategy_id, version)
);

create table if not exists public.strategy_validation_snapshots (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id text not null references public.strategy_versions(id),
  evaluated_at timestamptz not null default now(),
  sample_closed integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  win_rate double precision null,
  realized_pnl double precision not null default 0,
  gross_profit double precision not null default 0,
  gross_loss double precision not null default 0,
  profit_factor double precision null,
  expectancy double precision null,
  avg_win double precision null,
  avg_loss double precision null,
  payoff_ratio double precision null,
  max_drawdown_usd double precision null,
  max_drawdown_pct double precision null,
  sharpe_proxy double precision null,
  sortino_proxy double precision null,
  t_stat double precision null,
  max_loss_streak integer null,
  regime_breakdown jsonb not null default '{}'::jsonb,
  session_breakdown jsonb not null default '{}'::jsonb,
  walk_forward jsonb null,
  oos_evidence jsonb null,
  gates jsonb not null default '[]'::jsonb,
  verdict text not null default 'PAPER',
  reason text null,
  policy_version text not null,
  runner_version text null
);

create index if not exists idx_validation_strategy_time
  on public.strategy_validation_snapshots(strategy_version_id, evaluated_at desc);

-- v7 marks the lineage boundary before clean QVE cohorts.
insert into public.strategy_versions
  (id, strategy_id, profile_id, version, trade_type, status, params, source, activated_at, retired_at)
values
  ('futures_breakout_short_micro:v7','futures_breakout_short_micro','short_micro','v7','crypto_futures_breakout_short_micro','RETIRED','{}'::jsonb,'runner_v7',now(),now()),
  ('futures_breakout_short_core:v7','futures_breakout_short_core','short_core','v7','crypto_futures_breakout_short','RETIRED','{}'::jsonb,'runner_v7',now(),now()),
  ('futures_breakout_short_alt:v7','futures_breakout_short_alt','short_alt','v7','crypto_futures_breakout_short_alt','RETIRED','{}'::jsonb,'runner_v7',now(),now()),
  ('futures_breakout_long_probe:v7','futures_breakout_long_probe','long_probe','v7','crypto_futures_breakout_long','RETIRED','{}'::jsonb,'runner_v7',now(),now())
on conflict (id) do nothing;

insert into public.strategy_versions
  (id, strategy_id, profile_id, version, trade_type, status, params, parent_version_id, source, activated_at)
values
  ('futures_breakout_short_micro:v8','futures_breakout_short_micro','short_micro','v8','crypto_futures_breakout_short_micro','PAPER',
   '{"tf":"5m","lane":"SHORT","donchianPeriod":20,"marginUsd":150,"leverage":3,"timeoutHours":2}'::jsonb,
   'futures_breakout_short_micro:v7','genesis_quant_validation_engine',now()),
  ('futures_breakout_short_core:v8','futures_breakout_short_core','short_core','v8','crypto_futures_breakout_short','QUARANTINED',
   '{"tf":"1h","lane":"SHORT","donchianPeriod":34,"marginUsd":250,"leverage":5,"timeoutHours":4}'::jsonb,
   'futures_breakout_short_core:v7','genesis_quant_validation_engine',now()),
  ('futures_breakout_short_alt:v8','futures_breakout_short_alt','short_alt','v8','crypto_futures_breakout_short_alt','QUARANTINED',
   '{"tf":"15m","lane":"SHORT","donchianPeriod":12,"marginUsd":200,"leverage":3,"timeoutHours":3}'::jsonb,
   'futures_breakout_short_alt:v7','genesis_quant_validation_engine',now()),
  ('futures_breakout_long_probe:v8','futures_breakout_long_probe','long_probe','v8','crypto_futures_breakout_long','EXPERIMENT',
   '{"tf":"4h","lane":"LONG","donchianPeriod":55,"marginUsd":220,"leverage":3,"timeoutHours":6}'::jsonb,
   'futures_breakout_long_probe:v7','genesis_quant_validation_engine',now())
on conflict (id) do update set
  params = excluded.params,
  parent_version_id = excluded.parent_version_id,
  updated_at = now();

insert into public.org_state(key, value, updated_at)
values (
  'quant_validation_policy_v1',
  '{"version":"institutional_v1","quarantine":{"minClosed":10,"maxProfitFactor":0.8,"requireNegativeExpectancy":true},"validating":{"minClosed":30,"minProfitFactor":1.1,"minExpectancy":0},"validated":{"minClosed":50,"minProfitFactor":1.3,"minExpectancy":0,"minWinRate":0.45,"minTStat":2.0,"maxDrawdownPct":0.25,"requireWalkForward":true,"requireOos":true,"minPositiveRegimes":2},"capitalEligible":{"requiresFounderGate":true,"requiresCanonicalReconciliation":true,"requiresLivePreflight":true}}',
  now()::text
)
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

-- Only trades explicitly carrying RUNNER_V7 evidence are backfilled into v7.
-- Older history remains unversioned family evidence; it must never contaminate clean v8 cohorts.
update public.trades
set
  runner_version = 'v7',
  strategy_version_id = case trade_type
    when 'crypto_futures_breakout_short_micro' then 'futures_breakout_short_micro:v7'
    when 'crypto_futures_breakout_short' then 'futures_breakout_short_core:v7'
    when 'crypto_futures_breakout_short_alt' then 'futures_breakout_short_alt:v7'
    when 'crypto_futures_breakout_long' then 'futures_breakout_long_probe:v7'
    else strategy_version_id
  end,
  validation_status = 'LEGACY_VERSIONED'
where evidence like '%RUNNER_V7%'
  and strategy_version_id is null;
