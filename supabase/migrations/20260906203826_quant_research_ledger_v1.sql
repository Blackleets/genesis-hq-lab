-- Genesis Quant Research Ledger v1
-- Durable, append-only institutional memory for research evidence.
-- Research records have no execution authority and cannot become live/capital eligible.

create table if not exists public.quant_research_experiments (
  experiment_key text primary key,
  family text not null,
  strategy_name text not null,
  strategy_version text not null,
  stage text not null,
  verdict text not null,
  branch text,
  commit_sha text,
  engine_sha256 text,
  workflow_run_id bigint,
  artifact_id bigint,
  artifact_sha256 text,
  data_source text,
  data_start date,
  data_end date,
  n_assets integer,
  n_days integer,
  params jsonb not null default '{}'::jsonb,
  gates jsonb not null default '{}'::jsonb,
  development jsonb,
  validation jsonb,
  holdout jsonb,
  forward_evidence jsonb,
  holdout_state text not null,
  evidence_policy jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  capital_eligible boolean not null default false,
  live_orders boolean not null default false,
  created_at timestamptz not null default now(),
  constraint quant_research_no_capital check (capital_eligible = false),
  constraint quant_research_no_live_orders check (live_orders = false)
);

comment on table public.quant_research_experiments is
  'Append-only evidence ledger for Genesis quant research. No execution authority.';

create index if not exists quant_research_family_created_idx
  on public.quant_research_experiments (family, created_at desc);

create index if not exists quant_research_verdict_created_idx
  on public.quant_research_experiments (verdict, created_at desc);

alter table public.quant_research_experiments enable row level security;

-- Deliberately do not add anon/authenticated policies. Hosted read access is mediated
-- by genesis-runner-status using the service role. Service-role access bypasses RLS.
revoke all on table public.quant_research_experiments from anon, authenticated;

create or replace function public.prevent_quant_research_experiment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'quant_research_experiments is append-only; UPDATE/DELETE are forbidden';
end;
$$;

drop trigger if exists quant_research_experiments_append_only on public.quant_research_experiments;
create trigger quant_research_experiments_append_only
before update or delete on public.quant_research_experiments
for each row execute function public.prevent_quant_research_experiment_mutation();
