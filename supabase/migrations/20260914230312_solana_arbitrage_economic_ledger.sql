create table if not exists public.solana_arbitrage_observations (
  event_id text primary key,
  observed_at timestamptz not null,
  source text not null default 'supabase_pgcron',
  route text not null,
  venues jsonb not null default '[]'::jsonb,
  input_usd numeric not null,
  quoted_output_usdc numeric,
  quoted_edge_bps numeric,
  net_edge_bps numeric,
  expected_net_pnl_usd numeric,
  total_cost_usd numeric,
  quote_latency_ms integer,
  slot bigint,
  slot_drift integer,
  decision text not null,
  reason text,
  blockers jsonb not null default '[]'::jsonb,
  cost_model jsonb not null default '{}'::jsonb,
  mode text not null default 'SHADOW' check (mode = 'SHADOW'),
  execution_authority boolean not null default false check (execution_authority = false),
  live_locked boolean not null default true check (live_locked = true),
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists solana_arb_obs_observed_at_idx on public.solana_arbitrage_observations(observed_at desc);
create index if not exists solana_arb_obs_decision_idx on public.solana_arbitrage_observations(decision, observed_at desc);
create index if not exists solana_arb_obs_net_edge_idx on public.solana_arbitrage_observations(net_edge_bps desc, observed_at desc);

create table if not exists public.solana_paper_captures (
  capture_id uuid primary key default gen_random_uuid(),
  opportunity_event_id text not null unique references public.solana_arbitrage_observations(event_id) on delete restrict,
  captured_at timestamptz not null,
  route text not null,
  expected_net_pnl_usd numeric not null,
  expected_net_edge_bps numeric not null,
  captured_net_pnl_usd numeric,
  captured_net_edge_bps numeric,
  quote_decay_usd numeric,
  quote_decay_bps numeric,
  capture_ratio numeric,
  initial_quote_end_usdc numeric,
  capture_quote_end_usdc numeric,
  initial_cost_usd numeric,
  capture_cost_usd numeric,
  initial_slot bigint,
  capture_slot bigint,
  slot_drift integer,
  venues jsonb not null default '[]'::jsonb,
  capture_venues jsonb not null default '[]'::jsonb,
  status text not null check (status in ('CAPTURED','DECAYED','FAILED')),
  failure_reason text,
  mode text not null default 'PAPER' check (mode = 'PAPER'),
  execution_authority boolean not null default false check (execution_authority = false),
  live_locked boolean not null default true check (live_locked = true),
  raw_capture jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists solana_paper_captures_captured_at_idx on public.solana_paper_captures(captured_at desc);
create index if not exists solana_paper_captures_status_idx on public.solana_paper_captures(status, captured_at desc);

alter table public.solana_arbitrage_observations enable row level security;
alter table public.solana_paper_captures enable row level security;
revoke all on table public.solana_arbitrage_observations from anon, authenticated;
revoke all on table public.solana_paper_captures from anon, authenticated;
grant select, insert on table public.solana_arbitrage_observations to service_role;
grant select, insert on table public.solana_paper_captures to service_role;

create or replace function public.prevent_solana_arb_observation_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'solana_arbitrage_observations is append-only';
end $$;

drop trigger if exists trg_solana_arb_observations_append_only on public.solana_arbitrage_observations;
create trigger trg_solana_arb_observations_append_only
before update or delete on public.solana_arbitrage_observations
for each row execute function public.prevent_solana_arb_observation_mutation();

create or replace function public.prevent_solana_paper_capture_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'solana_paper_captures is append-only';
end $$;

drop trigger if exists trg_solana_paper_captures_append_only on public.solana_paper_captures;
create trigger trg_solana_paper_captures_append_only
before update or delete on public.solana_paper_captures
for each row execute function public.prevent_solana_paper_capture_mutation();
