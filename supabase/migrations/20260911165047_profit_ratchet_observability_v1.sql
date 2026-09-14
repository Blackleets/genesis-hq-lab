create table if not exists public.futures_ratchet_telemetry (
  trade_id text primary key references public.trades(id) on delete restrict,
  strategy_version_id text not null,
  runner_version text,
  exit_policy_version text,
  asset_pair text,
  side text,
  entry_regime text,
  entry_session text,
  leverage double precision,
  notional_usd double precision,
  initial_stop_price double precision,
  last_ratchet_stop_price double precision,
  mfe_net_usd double precision not null default 0,
  mae_observed_net_usd double precision,
  max_protected_profit_usd double precision not null default 0,
  current_net_pnl_usd double precision,
  realized_net_pnl_usd double precision,
  max_giveback_usd double precision,
  capture_efficiency double precision,
  giveback_pct_mfe double precision,
  protected_profit_efficiency double precision,
  ratchet_activated boolean not null default false,
  ratchet_raise_count integer not null default 0,
  ratchet_save_exit boolean not null default false,
  winner_lost boolean not null default false,
  counterfactual_without_ratchet_proven boolean not null default false,
  counterfactual_note text not null default 'not_demonstrable_from_observed_path',
  activation_at text,
  activation_strength text,
  activation_regime text,
  activation_momentum20 double precision,
  activation_order_book_imbalance double precision,
  activation_atr_pct double precision,
  last_context_at text,
  last_strength text,
  last_regime text,
  last_momentum20 double precision,
  last_order_book_imbalance double precision,
  last_atr_pct double precision,
  close_context_at text,
  close_strength text,
  close_regime text,
  close_momentum20 double precision,
  close_order_book_imbalance double precision,
  close_atr_pct double precision,
  close_context_source text,
  exit_reason text,
  opened_at text,
  closed_at text,
  observation_count integer not null default 0,
  telemetry_scope text not null default 'runner_tick_observed_net_economics',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint futures_ratchet_v9_only check (strategy_version_id like '%:v9'),
  constraint futures_ratchet_raise_count_nonnegative check (ratchet_raise_count >= 0),
  constraint futures_ratchet_mfe_nonnegative check (mfe_net_usd >= 0),
  constraint futures_ratchet_protected_nonnegative check (max_protected_profit_usd >= 0)
);

alter table public.futures_ratchet_telemetry enable row level security;
revoke all on table public.futures_ratchet_telemetry from anon, authenticated;

create index if not exists idx_futures_ratchet_strategy_version on public.futures_ratchet_telemetry(strategy_version_id);
create index if not exists idx_futures_ratchet_pair on public.futures_ratchet_telemetry(asset_pair);
create index if not exists idx_futures_ratchet_side on public.futures_ratchet_telemetry(side);
create index if not exists idx_futures_ratchet_entry_regime on public.futures_ratchet_telemetry(entry_regime);
create index if not exists idx_futures_ratchet_entry_session on public.futures_ratchet_telemetry(entry_session);
create index if not exists idx_futures_ratchet_exit_reason on public.futures_ratchet_telemetry(exit_reason);
create index if not exists idx_futures_ratchet_closed_at on public.futures_ratchet_telemetry(closed_at);

create or replace function public.genesis_seed_ratchet_trade()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.strategy_version_id, '') not like '%:v9' then
    return new;
  end if;

  insert into public.futures_ratchet_telemetry (
    trade_id, strategy_version_id, runner_version, exit_policy_version, asset_pair, side,
    entry_regime, entry_session, leverage, notional_usd, initial_stop_price, opened_at, updated_at
  ) values (
    new.id, new.strategy_version_id, new.runner_version, 'adaptive_profit_ratchet_v1', new.asset_pair, new.outcome,
    new.entry_regime, new.entry_session, new.leverage, new.notional_usd, new.stop_price, new.opened_at, now()
  )
  on conflict (trade_id) do nothing;

  return new;
end;
$$;

create or replace function public.genesis_apply_ratchet_snapshot(snapshot jsonb, observed_at text)
returns void
language plpgsql
as $$
declare
  v_trade_id text := snapshot->>'tradeId';
  v_strategy_version text := snapshot->>'strategyVersionId';
  v_current double precision := nullif(snapshot->>'currentNetPnlUsd', '')::double precision;
  v_mfe double precision := greatest(coalesce(nullif(snapshot->>'mfeUsd', '')::double precision, 0), 0);
  v_floor double precision := greatest(coalesce(nullif(snapshot->>'floorUsd', '')::double precision, 0), 0);
  v_stop double precision := nullif(snapshot->>'ratchetStopPrice', '')::double precision;
  v_context jsonb := coalesce(snapshot->'context', '{}'::jsonb);
  v_existing_floor double precision;
  v_existing_activation text;
begin
  if v_trade_id is null or coalesce(v_strategy_version, '') not like '%:v9' then
    return;
  end if;

  insert into public.futures_ratchet_telemetry (
    trade_id, strategy_version_id, runner_version, exit_policy_version, asset_pair, side,
    mfe_net_usd, mae_observed_net_usd, max_protected_profit_usd, current_net_pnl_usd,
    last_ratchet_stop_price, ratchet_activated, observation_count, last_context_at,
    last_strength, last_regime, last_momentum20, last_order_book_imbalance, last_atr_pct, updated_at
  ) values (
    v_trade_id, v_strategy_version, snapshot->>'runnerVersion', snapshot->>'exitPolicyVersion', snapshot->>'pair', snapshot->>'side',
    v_mfe, v_current, v_floor, v_current, v_stop,
    coalesce((snapshot->>'active')::boolean, false), 1, observed_at,
    v_context->>'strength', v_context->>'regime', nullif(v_context->>'momentum20', '')::double precision,
    nullif(v_context->>'orderBookImbalance', '')::double precision, nullif(v_context->>'atrPct', '')::double precision, now()
  )
  on conflict (trade_id) do update set
    runner_version = coalesce(excluded.runner_version, futures_ratchet_telemetry.runner_version),
    exit_policy_version = coalesce(excluded.exit_policy_version, futures_ratchet_telemetry.exit_policy_version),
    asset_pair = coalesce(excluded.asset_pair, futures_ratchet_telemetry.asset_pair),
    side = coalesce(excluded.side, futures_ratchet_telemetry.side),
    mfe_net_usd = greatest(futures_ratchet_telemetry.mfe_net_usd, excluded.mfe_net_usd),
    mae_observed_net_usd = case
      when futures_ratchet_telemetry.mae_observed_net_usd is null then excluded.mae_observed_net_usd
      when excluded.mae_observed_net_usd is null then futures_ratchet_telemetry.mae_observed_net_usd
      else least(futures_ratchet_telemetry.mae_observed_net_usd, excluded.mae_observed_net_usd)
    end,
    ratchet_raise_count = futures_ratchet_telemetry.ratchet_raise_count + case when excluded.max_protected_profit_usd > futures_ratchet_telemetry.max_protected_profit_usd then 1 else 0 end,
    max_protected_profit_usd = greatest(futures_ratchet_telemetry.max_protected_profit_usd, excluded.max_protected_profit_usd),
    current_net_pnl_usd = excluded.current_net_pnl_usd,
    last_ratchet_stop_price = coalesce(excluded.last_ratchet_stop_price, futures_ratchet_telemetry.last_ratchet_stop_price),
    ratchet_activated = futures_ratchet_telemetry.ratchet_activated or excluded.ratchet_activated,
    observation_count = futures_ratchet_telemetry.observation_count + 1,
    last_context_at = excluded.last_context_at,
    last_strength = excluded.last_strength,
    last_regime = excluded.last_regime,
    last_momentum20 = excluded.last_momentum20,
    last_order_book_imbalance = excluded.last_order_book_imbalance,
    last_atr_pct = excluded.last_atr_pct,
    updated_at = now();

  select max_protected_profit_usd, activation_at
    into v_existing_floor, v_existing_activation
  from public.futures_ratchet_telemetry
  where trade_id = v_trade_id;

  if coalesce((snapshot->>'active')::boolean, false) and v_existing_activation is null then
    update public.futures_ratchet_telemetry
    set activation_at = observed_at,
        activation_strength = v_context->>'strength',
        activation_regime = v_context->>'regime',
        activation_momentum20 = nullif(v_context->>'momentum20', '')::double precision,
        activation_order_book_imbalance = nullif(v_context->>'orderBookImbalance', '')::double precision,
        activation_atr_pct = nullif(v_context->>'atrPct', '')::double precision,
        updated_at = now()
    where trade_id = v_trade_id;
  end if;
end;
$$;

create or replace function public.genesis_finalize_ratchet_trade(
  p_trade_id text,
  p_realized double precision,
  p_exit_reason text,
  p_closed_at text,
  p_mfe double precision default null,
  p_floor double precision default null,
  p_close_context jsonb default null,
  p_context_at text default null,
  p_runner_version text default null,
  p_exit_policy_version text default null
)
returns void
language plpgsql
as $$
declare
  v_mfe double precision;
  v_floor double precision;
  v_realized double precision := coalesce(p_realized, 0);
  v_giveback double precision;
begin
  update public.futures_ratchet_telemetry
  set mfe_net_usd = greatest(mfe_net_usd, coalesce(p_mfe, 0), v_realized, 0),
      mae_observed_net_usd = case
        when mae_observed_net_usd is null then v_realized
        else least(mae_observed_net_usd, v_realized)
      end,
      max_protected_profit_usd = greatest(max_protected_profit_usd, coalesce(p_floor, 0)),
      current_net_pnl_usd = v_realized,
      realized_net_pnl_usd = v_realized,
      exit_reason = coalesce(p_exit_reason, exit_reason),
      closed_at = coalesce(p_closed_at, closed_at),
      runner_version = coalesce(p_runner_version, runner_version),
      exit_policy_version = coalesce(p_exit_policy_version, exit_policy_version),
      close_context_at = coalesce(p_context_at, close_context_at),
      close_strength = coalesce(p_close_context->>'strength', close_strength),
      close_regime = coalesce(p_close_context->>'regime', close_regime),
      close_momentum20 = coalesce(nullif(p_close_context->>'momentum20', '')::double precision, close_momentum20),
      close_order_book_imbalance = coalesce(nullif(p_close_context->>'orderBookImbalance', '')::double precision, close_order_book_imbalance),
      close_atr_pct = coalesce(nullif(p_close_context->>'atrPct', '')::double precision, close_atr_pct),
      close_context_source = case when p_close_context is not null then 'runner_close_cycle_context' else coalesce(close_context_source, 'last_preclose_snapshot') end,
      ratchet_save_exit = coalesce(p_exit_reason, exit_reason) in ('profit_ratchet', 'profit_ratchet_stop') and v_realized > 0,
      updated_at = now(),
      finalized_at = now()
  where trade_id = p_trade_id;

  select mfe_net_usd, max_protected_profit_usd into v_mfe, v_floor
  from public.futures_ratchet_telemetry where trade_id = p_trade_id;

  if not found then return; end if;

  v_giveback := greatest(v_mfe - v_realized, 0);
  update public.futures_ratchet_telemetry
  set max_giveback_usd = v_giveback,
      capture_efficiency = case when v_mfe > 0 then v_realized / v_mfe else null end,
      giveback_pct_mfe = case when v_mfe > 0 then v_giveback / v_mfe else null end,
      protected_profit_efficiency = case when v_floor > 0 then v_realized / v_floor else null end,
      winner_lost = v_mfe >= 5 and v_realized <= 0,
      counterfactual_without_ratchet_proven = false,
      counterfactual_note = 'not_demonstrable_from_observed_path',
      updated_at = now()
  where trade_id = p_trade_id;
end;
$$;

create or replace function public.genesis_capture_ratchet_org_state()
returns trigger
language plpgsql
as $$
declare
  payload jsonb;
  item record;
  closed_item jsonb;
  observed_at text;
begin
  begin
    payload := new.value::jsonb;
  exception when others then
    return new;
  end;

  if new.key = 'futures_profit_ratchet_v1' and jsonb_typeof(payload) = 'object' then
    observed_at := coalesce(new.updated_at, now()::text);
    for item in select value from jsonb_each(payload) loop
      perform public.genesis_apply_ratchet_snapshot(item.value, observed_at);
    end loop;
  elsif new.key = 'external_runner_heartbeat' then
    observed_at := coalesce(payload->>'lastTickAt', new.updated_at, now()::text);
    if jsonb_typeof(payload#>'{lastResult,profitRatchets}') = 'array' then
      for closed_item in select value from jsonb_array_elements(payload#>'{lastResult,profitRatchets}') loop
        perform public.genesis_apply_ratchet_snapshot(closed_item, coalesce(closed_item->>'updatedAt', observed_at));
      end loop;
    end if;
    if jsonb_typeof(payload#>'{lastResult,closedPositions}') = 'array' then
      for closed_item in select value from jsonb_array_elements(payload#>'{lastResult,closedPositions}') loop
        if coalesce(closed_item->>'strategyVersionId', '') like '%:v9' then
          perform public.genesis_finalize_ratchet_trade(
            closed_item->>'id',
            nullif(closed_item->>'pnl', '')::double precision,
            closed_item->>'reason',
            observed_at,
            nullif(closed_item->>'mfeUsd', '')::double precision,
            nullif(closed_item->>'protectedFloorUsd', '')::double precision,
            closed_item->'exitContext',
            observed_at,
            closed_item->>'runnerVersion',
            closed_item->>'exitPolicyVersion'
          );
        end if;
      end loop;
    end if;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

create or replace function public.genesis_finalize_ratchet_on_trade_close()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.strategy_version_id, '') like '%:v9'
     and new.status = 'closed'
     and coalesce(old.status, '') <> 'closed' then
    perform public.genesis_finalize_ratchet_trade(new.id, new.pnl, new.exit_reason, new.closed_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_genesis_seed_ratchet_trade on public.trades;
create trigger trg_genesis_seed_ratchet_trade
after insert on public.trades
for each row execute function public.genesis_seed_ratchet_trade();

drop trigger if exists trg_genesis_finalize_ratchet_trade on public.trades;
create trigger trg_genesis_finalize_ratchet_trade
after update of status, pnl, exit_reason, closed_at on public.trades
for each row execute function public.genesis_finalize_ratchet_on_trade_close();

drop trigger if exists trg_genesis_capture_ratchet_org_state on public.org_state;
create trigger trg_genesis_capture_ratchet_org_state
after insert or update of value, updated_at on public.org_state
for each row
when (new.key in ('futures_profit_ratchet_v1', 'external_runner_heartbeat'))
execute function public.genesis_capture_ratchet_org_state();

insert into public.futures_ratchet_telemetry (
  trade_id, strategy_version_id, runner_version, exit_policy_version, asset_pair, side,
  entry_regime, entry_session, leverage, notional_usd, initial_stop_price, opened_at,
  realized_net_pnl_usd, current_net_pnl_usd, exit_reason, closed_at, finalized_at, updated_at
)
select id, strategy_version_id, runner_version, 'adaptive_profit_ratchet_v1', asset_pair, outcome,
       entry_regime, entry_session, leverage, notional_usd, stop_price, opened_at,
       case when status = 'closed' then pnl else null end,
       case when status = 'closed' then pnl else null end,
       exit_reason, closed_at,
       case when status = 'closed' then now() else null end, now()
from public.trades
where strategy_version_id like '%:v9'
on conflict (trade_id) do nothing;

do $$
declare
  state_value text;
  state_at text;
  payload jsonb;
  item record;
begin
  select value, updated_at into state_value, state_at
  from public.org_state where key = 'futures_profit_ratchet_v1' limit 1;
  if state_value is not null then
    payload := state_value::jsonb;
    if jsonb_typeof(payload) = 'object' then
      for item in select value from jsonb_each(payload) loop
        perform public.genesis_apply_ratchet_snapshot(item.value, state_at);
      end loop;
    end if;
  end if;
end;
$$;

create or replace view public.v_futures_ratchet_trade_metrics
with (security_invoker = true)
as
select
  t.*,
  case
    when t.mfe_net_usd < 5 then '$0-5'
    when t.mfe_net_usd < 10 then '$5-10'
    when t.mfe_net_usd < 25 then '$10-25'
    when t.mfe_net_usd < 50 then '$25-50'
    when t.mfe_net_usd < 100 then '$50-100'
    else '$100+'
  end as mfe_band,
  case
    when t.notional_usd is null then 'UNATTRIBUTED'
    when t.notional_usd < 500 then '<$500'
    when t.notional_usd < 1000 then '$500-1K'
    when t.notional_usd < 2500 then '$1K-2.5K'
    else '$2.5K+'
  end as notional_band,
  coalesce(t.activation_strength, t.last_strength, 'UNATTRIBUTED') as context_strength
from public.futures_ratchet_telemetry t;

revoke all on table public.v_futures_ratchet_trade_metrics from anon, authenticated;
